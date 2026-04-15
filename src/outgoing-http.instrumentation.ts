import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { TRAFFIC_DESK_OPTIONS } from "./constants";
import { ResolvedTrafficDeskModuleOptions } from "./types/traffic-desk-options";
import { TrafficLoggingService } from "./traffic-logging.service";
import { clampBody, redactHeaders } from "./utils/log-sanitizer";

type FetchLike = typeof fetch;

@Injectable()
export class OutgoingHttpInstrumentation implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutgoingHttpInstrumentation.name);
  private originalFetch?: FetchLike;

  constructor(
    @Inject(TRAFFIC_DESK_OPTIONS)
    private readonly options: ResolvedTrafficDeskModuleOptions,
    private readonly logging: TrafficLoggingService
  ) {}

  onModuleInit(): void {
    if (!this.options.enableOutgoingHttp) {
      return;
    }

    if (typeof globalThis.fetch !== "function") {
      this.logger.warn("Outgoing HTTP capture is enabled, but global fetch is unavailable.");
      return;
    }

    if (this.originalFetch) {
      return;
    }

    this.originalFetch = globalThis.fetch.bind(globalThis);
    const original = this.originalFetch;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const startedAt = Date.now();
      const method = this.resolveMethod(input, init);
      const path = this.resolvePath(input);
      const requestHeaders = this.resolveHeaders(input, init);
      const requestBody = this.resolveRequestBody(input, init);

      try {
        const response = await original(input, init);
        const responseBody = this.options.captureResponseBody
          ? await this.readResponseBody(response.clone())
          : undefined;

        this.logging.add({
          id: randomUUID(),
          direction: "outgoing",
          correlationId:
            (requestHeaders["x-correlation-id"] as string | undefined) ?? randomUUID(),
          timestamp: new Date().toISOString(),
          method,
          path,
          statusCode: response.status,
          durationMs: Date.now() - startedAt,
          requestHeaders: redactHeaders(requestHeaders, this.options.redactHeaders),
          requestBody: this.options.captureRequestBody
            ? clampBody(requestBody, this.options.maxBodySizeBytes)
            : undefined,
          responseBody: this.options.captureResponseBody
            ? clampBody(responseBody, this.options.maxBodySizeBytes)
            : undefined
        });

        return response;
      } catch (error) {
        this.logging.add({
          id: randomUUID(),
          direction: "outgoing",
          correlationId:
            (requestHeaders["x-correlation-id"] as string | undefined) ?? randomUUID(),
          timestamp: new Date().toISOString(),
          method,
          path,
          statusCode: 599,
          durationMs: Date.now() - startedAt,
          requestHeaders: redactHeaders(requestHeaders, this.options.redactHeaders),
          requestBody: this.options.captureRequestBody
            ? clampBody(requestBody, this.options.maxBodySizeBytes)
            : undefined,
          responseBody: this.options.captureResponseBody
            ? clampBody(
                { error: this.errorMessage(error) },
                this.options.maxBodySizeBytes
              )
            : undefined
        });

        throw error;
      }
    };

    this.logger.log("Outgoing HTTP capture is enabled (global fetch instrumentation).");
  }

  onModuleDestroy(): void {
    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = undefined;
    }
  }

  private resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
    const requestMethod = input instanceof Request ? input.method : undefined;
    return (init?.method ?? requestMethod ?? "GET").toUpperCase();
  }

  private resolvePath(input: RequestInfo | URL): string {
    if (typeof input === "string") {
      return input;
    }
    if (input instanceof URL) {
      return input.toString();
    }
    return input.url;
  }

  private resolveHeaders(input: RequestInfo | URL, init?: RequestInit): Record<string, unknown> {
    const fromInput = input instanceof Request ? this.headersToRecord(input.headers) : {};
    const fromInit = this.headersToRecord(init?.headers);
    return {
      ...fromInput,
      ...fromInit
    };
  }

  private resolveRequestBody(input: RequestInfo | URL, init?: RequestInit): unknown {
    const body = init?.body ?? (input instanceof Request ? input.body : undefined);
    if (body === undefined || body === null) {
      return undefined;
    }

    if (typeof body === "string") {
      return body;
    }

    if (body instanceof URLSearchParams) {
      return body.toString();
    }

    if (typeof FormData !== "undefined" && body instanceof FormData) {
      const map: Record<string, unknown> = {};
      body.forEach((value, key) => {
        map[key] = typeof value === "string" ? value : "[Binary]";
      });
      return map;
    }

    return "[Non-serializable request body]";
  }

  private headersToRecord(headers: HeadersInit | undefined): Record<string, unknown> {
    if (!headers) {
      return {};
    }

    if (headers instanceof Headers) {
      const record: Record<string, unknown> = {};
      headers.forEach((value, key) => {
        record[key] = value;
      });
      return record;
    }

    if (Array.isArray(headers)) {
      return Object.fromEntries(headers);
    }

    return { ...headers };
  }

  private async readResponseBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();

    if (contentType.includes("application/json")) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    return text;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return "Outgoing request failed";
  }
}
