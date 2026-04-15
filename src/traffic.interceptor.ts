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
import { TRAFFIC_DESK_OPTIONS, TRAFFIC_DESK_REQUEST_CAPTURED_FLAG } from "./constants";
import { ResolvedTrafficDeskModuleOptions } from "./types/traffic-desk-options";
import { TrafficLoggingService } from "./traffic-logging.service";
import { clampBody, redactHeaders } from "./utils/log-sanitizer";

@Injectable()
export class TrafficInterceptor implements NestInterceptor {
  constructor(
    @Inject(TRAFFIC_DESK_OPTIONS)
    private readonly options: ResolvedTrafficDeskModuleOptions,
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
    (request as Record<string, unknown>)[TRAFFIC_DESK_REQUEST_CAPTURED_FLAG] = true;

    // Support both ignorePaths and excludePaths (from module options)
    const allIgnorePaths = [
      ...(this.options.ignorePaths || []),
      ...(this.options.excludePaths || [])
    ];

    if (allIgnorePaths.some((ignored) => path.startsWith(ignored))) {
      return next.handle();
    }

    const startedAt = Date.now();
    let responseBody: unknown;
    let responseStatus = 500;

    let errorMessage: string | undefined;
    let errorStack: string | undefined;

    return next.handle().pipe(
      tap({
        next: (data) => {
          responseBody = data;
          responseStatus = response.statusCode ?? 200;
        },
        error: (err) => {
          // Improved extraction for common auth/401 errors and NestJS exceptions
          responseStatus =
            err?.status ??
            (typeof err?.getStatus === "function" ? err.getStatus() : undefined) ??
            (err?.response?.statusCode) ??
            ((response.statusCode ?? 0) >= 400 ? response.statusCode! : 500);

          const detail = err?.response ?? err;
          const detailMessage = Array.isArray(detail?.message)
            ? detail.message.join(", ")
            : detail?.message;
          errorMessage =
            detailMessage ||
            detail?.error ||
            err?.message ||
            (typeof detail === "string" ? detail : "Unauthorized or unhandled error");
          errorStack = err?.stack;
          responseBody = detail;

          // Ensure 401s from common NestJS UnauthorizedException are captured
          if (responseStatus === 401 && (!errorMessage || !errorMessage.includes("Unauthorized"))) {
            errorMessage = "Unauthorized";
          }
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
          errorMessage,
          errorStack,
          remoteAddress: request.ip
        };

        this.logging.add(entry);
      })
    );
  }
}
