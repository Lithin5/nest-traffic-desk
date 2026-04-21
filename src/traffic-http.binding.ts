import { Inject, Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import type { AbstractHttpAdapter } from "@nestjs/core";
import type { HttpAdapterHost } from "@nestjs/core";
import { existsSync, readFileSync, statSync } from "fs";
import type { IncomingMessage } from "http";
import { extname, join, normalize } from "path";
import { TRAFFIC_DESK_OPTIONS } from "./constants";
import { ResolvedTrafficDeskModuleOptions } from "./types/traffic-desk-options";
import { TrafficLoggingService } from "./traffic-logging.service";
import { TrafficDeskGateway } from "./traffic-desk.gateway";
import { TrafficFilterQuery } from "./types/traffic-filter-query";

interface QueryLike {
  [key: string]: string | string[] | undefined;
}

/**
 * Token for HttpAdapterHost from the same @nestjs/core instance the host app uses.
 * Constructor-injecting ModuleRef or HttpAdapterHost from a static import breaks when the
 * library resolves a different physical @nestjs/core than Nest's DI (e.g. pnpm duplicate copies).
 */
const HTTP_ADAPTER_HOST_TOKEN = (() => {
  const corePath = require.resolve("@nestjs/core", {
    paths: [process.cwd(), __dirname]
  });
  return (require(corePath) as typeof import("@nestjs/core")).HttpAdapterHost;
})();

@Injectable()
export class TrafficHttpBinding implements OnModuleInit {
  private readonly logger = new Logger(TrafficHttpBinding.name);

  constructor(
    @Optional()
    @Inject(HTTP_ADAPTER_HOST_TOKEN)
    private readonly httpAdapterHost: HttpAdapterHost | undefined,
    private readonly logging: TrafficLoggingService,
    private readonly gateway: TrafficDeskGateway,
    @Inject(TRAFFIC_DESK_OPTIONS)
    private readonly options: ResolvedTrafficDeskModuleOptions
  ) {
    // Bind during provider construction (NestFactory.initialize), before NestApplication.init().
    // That places routes on the adapter before registerRouterHooks() installs the catch-all 404.
    // Socket.IO is also attached here — it only hooks upgrade events, so attaching before
    // listen() is safe and ensures the WebSocket server is ready when the first client connects.
    const adapter = this.httpAdapterHost?.httpAdapter;
    if (!adapter) {
      this.logger.warn(
        "Could not resolve HttpAdapterHost / HTTP adapter, so /_logs routes were not bound. Use a single @nestjs/core in the app (npm dedupe / overrides) or ensure NestFactory.create() is used."
      );
      return;
    }

    this.bindAdapterRoutes(adapter);
    this.logger.log(
      `Traffic desk HTTP routes registered (data: ${this.options.dataPath}, UI: ${this.options.enableUi ? this.options.uiBasePath : "off"})`
    );
  }

  onModuleInit(): void {
    const adapter = this.httpAdapterHost?.httpAdapter;
    if (!adapter) return;
    this.gateway.attachToHttpServer(adapter.getHttpServer());
  }

  private bindAdapterRoutes(adapter: AbstractHttpAdapter): void {
    const dataPath = this.ensureLeadingSlash(this.options.dataPath);
    adapter.get(dataPath, (req: unknown, res: unknown) => {
      const query = this.getQuery(req);
      const payload = this.logging.query(this.parseFilters(query));
      adapter.reply(res, payload);
    });

    adapter.get(`${dataPath}/`, (req: unknown, res: unknown) => {
      const query = this.getQuery(req);
      const payload = this.logging.query(this.parseFilters(query));
      adapter.reply(res, payload);
    });

    if (!this.options.enableUi) {
      return;
    }

    const uiBasePath = this.ensureLeadingSlash(this.options.uiBasePath);
    const distPath = this.resolveUiDistPath();
    if (!distPath) {
      this.logger.warn(
        `UI is enabled but no build output was found. Expected a built dashboard at assets/ui or ${this.options.uiDistPath}.`
      );
      adapter.get(uiBasePath, (_req: unknown, res: unknown) => {
        adapter.reply(
          res,
          {
            message:
              "nest-traffic-desk UI assets are missing. Run `npm run build:ui` before serving."
          },
          503
        );
      });
      return;
    }

    adapter.get(`${uiBasePath}/config`, (_req: unknown, res: unknown) => {
      adapter.reply(res, {
        dataPath: this.options.dataPath,
        websocketNamespace: this.options.websocketNamespace,
        ignorePaths: this.logging.getIgnorePaths(),
        dynamicIgnorePaths: this.logging.getDynamicIgnorePaths()
      });
    });

    adapter.post(`${uiBasePath}/ignore`, async (req: any, res: any) => {
      let body: Record<string, unknown>;
      try {
        body = await this.parseJsonBodyIfNeeded(req);
      } catch {
        adapter.reply(res, { success: false, message: "Invalid JSON body" }, 400);
        return;
      }
      const pathRaw = body.path;
      const path = typeof pathRaw === "string" ? pathRaw : undefined;
      if (path) this.logging.addIgnorePath(path);
      adapter.reply(res, { success: true });
    });

    adapter.delete(`${uiBasePath}/ignore`, async (req: any, res: any) => {
      let body: Record<string, unknown>;
      try {
        body = await this.parseJsonBodyIfNeeded(req);
      } catch {
        adapter.reply(res, { success: false, message: "Invalid JSON body" }, 400);
        return;
      }
      const bodyPath = typeof body.path === "string" ? body.path : undefined;
      const pathValue = bodyPath ?? this.asString(this.getQuery(req).path);
      if (pathValue && typeof pathValue === "string") {
        this.logging.removeIgnorePath(pathValue);
      }
      adapter.reply(res, { success: true });
    });

    adapter.get(uiBasePath, (_req: unknown, res: unknown) => {
      this.serveIndex(adapter, res, distPath, uiBasePath);
    });

    adapter.get(`${uiBasePath}/`, (_req: unknown, res: unknown) => {
      this.serveIndex(adapter, res, distPath, uiBasePath);
    });

    adapter.get(`${uiBasePath}/*path`, (req: unknown, res: unknown) => {
      const pathValue = this.getPath(req);
      const assetPath = pathValue.replace(uiBasePath, "");
      if (!assetPath || assetPath === "/") {
        this.serveIndex(adapter, res, distPath, uiBasePath);
        return;
      }

      const normalized = normalize(assetPath).replace(/^(\.\.(\/|\\|$))+/, "");
      const absolutePath = join(distPath, normalized);
      if (!absolutePath.startsWith(distPath) || !existsSync(absolutePath) || statSync(absolutePath).isDirectory()) {
        this.serveIndex(adapter, res, distPath, uiBasePath);
        return;
      }

      // Use the native response's send() for static assets so Buffers are
      // transmitted as raw bytes rather than JSON-serialised by adapter.reply().
      const nativeRes = res as { status: Function; setHeader: Function; send: Function };
      nativeRes.setHeader("content-type", this.mimeTypeFor(absolutePath));
      nativeRes.status(200).send(readFileSync(absolutePath));
    });
  }

  private parseFilters(query: QueryLike): TrafficFilterQuery {
    const methodRaw = this.asString(query.method);
    const methods = methodRaw
      ? methodRaw
          .split(",")
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean)
      : undefined;
    const statusRaw = this.asString(query.status);
    const sortRaw = this.asString(query.sort);
    const limitRaw = this.asString(query.limit);

    let statusClass: number | undefined;
    let statusExact: number | undefined;
    if (statusRaw) {
      if (/^\dxx$/i.test(statusRaw)) {
        statusClass = Number(statusRaw[0]);
      } else if (/^\d{3}$/.test(statusRaw)) {
        statusExact = Number(statusRaw);
      }
    }

    return {
      q: this.asString(query.q),
      methods,
      status: statusExact,
      statusClass,
      sort: sortRaw === "asc" ? "asc" : "desc",
      limit: limitRaw ? Number(limitRaw) : undefined
    };
  }

  private resolveUiDistPath(): string | undefined {
    // This file lives in dist/; package root is one level up (not two — two skips past nest-traffic-desk).
    const packagedAssets = join(__dirname, "..", "assets", "ui");

    const candidates = [
      this.options.uiDistPath,
      join(process.cwd(), "assets", "ui"),
      join(process.cwd(), "ui", "dist"),
      packagedAssets
    ].filter(Boolean) as string[];

    return candidates.find((path) => existsSync(path) && existsSync(join(path, "index.html")));
  }

  private serveIndex(
    adapter: { reply: Function; setHeader: Function },
    res: unknown,
    distPath: string,
    uiBasePath: string
  ): void {
    const indexPath = join(distPath, "index.html");
    if (!existsSync(indexPath)) {
      adapter.reply(
        res,
        { message: "nest-traffic-desk UI index.html is missing." },
        503
      );
      return;
    }

    let html = readFileSync(indexPath, "utf-8");

    // Inject <base> so that relative asset paths (./assets/...) in the built HTML
    // always resolve under the correct prefix, regardless of whether the browser
    // landed on /_logs or /_logs/.
    const base = uiBasePath.endsWith("/") ? uiBasePath : `${uiBasePath}/`;
    html = html.replace(/(<head[^>]*>)/i, `$1<base href="${base}">`);

    adapter.setHeader(res, "content-type", "text/html; charset=utf-8");
    adapter.reply(res, html, 200);
  }

  private mimeTypeFor(path: string): string {
    switch (extname(path).toLowerCase()) {
      case ".js":
        return "application/javascript; charset=utf-8";
      case ".css":
        return "text/css; charset=utf-8";
      case ".json":
        return "application/json; charset=utf-8";
      case ".svg":
        return "image/svg+xml";
      case ".png":
        return "image/png";
      case ".ico":
        return "image/x-icon";
      default:
        return "text/plain; charset=utf-8";
    }
  }

  private getQuery(req: unknown): QueryLike {
    const record = req as { query?: QueryLike };
    return record.query ?? {};
  }

  private getPath(req: unknown): string {
    const record = req as { originalUrl?: string; url?: string };
    return record.originalUrl ?? record.url ?? "/";
  }

  private asString(value: string | string[] | undefined): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }

  private ensureLeadingSlash(path: string): string {
    return path.startsWith("/") ? path : `/${path}`;
  }

  /**
   * Traffic desk registers these routes from the provider constructor, which runs before
   * Nest/Express applies `express.json()`, so `req.body` is often undefined here. Read the
   * raw stream when needed so JSON bodies still parse.
   */
  private async parseJsonBodyIfNeeded(req: {
    body?: unknown;
    on?: IncomingMessage["on"];
  }): Promise<Record<string, unknown>> {
    const b = req.body;
    if (b != null && typeof b === "object" && !Buffer.isBuffer(b)) {
      return b as Record<string, unknown>;
    }
    if (typeof b === "string") {
      const t = b.trim();
      if (!t) return {};
      return JSON.parse(t) as Record<string, unknown>;
    }
    if (typeof req.on !== "function") {
      return {};
    }
    const incoming = req as IncomingMessage;
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("end", () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf8").trim();
          if (!raw) {
            resolve({});
            return;
          }
          resolve(JSON.parse(raw) as Record<string, unknown>);
        } catch (err) {
          reject(err);
        }
      });
      incoming.on("error", reject);
    });
  }
}
