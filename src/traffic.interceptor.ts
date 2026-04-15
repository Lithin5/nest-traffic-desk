import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor
} from "@nestjs/common";
import { Observable } from "rxjs";
import { finalize, tap } from "rxjs/operators";
import { randomUUID } from "crypto";
import { TRAFFIC_DESK_OPTIONS } from "./constants";
import { TrafficDeskModuleOptions } from "./types/traffic-desk-options";
import { TrafficLoggingService } from "./traffic-logging.service";
import { clampBody, redactHeaders } from "./utils/log-sanitizer";

@Injectable()
export class TrafficInterceptor implements NestInterceptor {
  constructor(
    @Inject(TRAFFIC_DESK_OPTIONS)
    private readonly options: Required<TrafficDeskModuleOptions>,
    private readonly logging: TrafficLoggingService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.options.enabled || context.getType() !== "http") {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<
      {
        method?: string;
        originalUrl?: string;
        url?: string;
        headers?: Record<string, unknown>;
        body?: unknown;
        ip?: string;
      }
    >();
    const response = http.getResponse<{ statusCode?: number }>();
    const path = request.originalUrl ?? request.url ?? "/";

    if (this.options.ignorePaths.some((ignored) => path.startsWith(ignored))) {
      return next.handle();
    }

    const startedAt = Date.now();
    let responseBody: unknown;
    let responseStatus = 500;

    return next.handle().pipe(
      tap({
        next: (data) => {
          responseBody = data;
          responseStatus = response.statusCode ?? 200;
        },
        error: (err) => {
          responseStatus = err?.status ?? response.statusCode ?? 500;
          responseBody = {
            error: err?.message ?? "Unhandled error"
          };
        }
      }),
      finalize(() => {
        const entry = {
          id: randomUUID(),
          direction: "incoming" as const,
          correlationId:
            (request.headers?.["x-correlation-id"] as string | undefined) ?? randomUUID(),
          timestamp: new Date().toISOString(),
          method: (request.method ?? "GET").toUpperCase(),
          path,
          statusCode: responseStatus,
          durationMs: Date.now() - startedAt,
          requestHeaders: redactHeaders(request.headers, this.options.redactHeaders),
          requestBody: this.options.captureRequestBody
            ? clampBody(request.body, this.options.maxBodySizeBytes)
            : undefined,
          responseBody: this.options.captureResponseBody
            ? clampBody(responseBody, this.options.maxBodySizeBytes)
            : undefined,
          remoteAddress: request.ip
        };

        this.logging.add(entry);
      })
    );
  }
}
