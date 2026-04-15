import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Inject } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { randomUUID } from "crypto";
import {
  TRAFFIC_DESK_OPTIONS,
  TRAFFIC_DESK_REQUEST_CAPTURED_FLAG
} from "./constants";
import { ResolvedTrafficDeskModuleOptions } from "./types/traffic-desk-options";
import { TrafficLoggingService } from "./traffic-logging.service";
import { clampBody, redactHeaders } from "./utils/log-sanitizer";

type HttpRequestLike = {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers?: Record<string, unknown>;
  body?: unknown;
  ip?: string;
  [TRAFFIC_DESK_REQUEST_CAPTURED_FLAG]?: unknown;
};

@Catch()
export class TrafficExceptionFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  constructor(
    @Inject(TRAFFIC_DESK_OPTIONS)
    private readonly options: ResolvedTrafficDeskModuleOptions,
    private readonly logging: TrafficLoggingService
  ) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === "http" && this.options.enabled) {
      const http = host.switchToHttp();
      const request = http.getRequest<HttpRequestLike>();
      const response = http.getResponse<{ statusCode?: number }>();
      const alreadyCaptured = Boolean(request?.[TRAFFIC_DESK_REQUEST_CAPTURED_FLAG]);

      if (!alreadyCaptured) {
        const detail =
          exception instanceof HttpException ? exception.getResponse() : exception;
        const statusCode =
          exception instanceof HttpException
            ? exception.getStatus()
            : (response.statusCode ?? 500);
        const detailMessage =
          detail && typeof detail === "object"
            ? Array.isArray((detail as { message?: unknown }).message)
              ? ((detail as { message?: unknown[] }).message ?? []).join(", ")
              : (detail as { message?: string }).message
            : undefined;
        const errorMessage =
          detailMessage ||
          (detail && typeof detail === "object"
            ? (detail as { error?: string }).error
            : undefined) ||
          (typeof detail === "string" ? detail : undefined) ||
          (exception instanceof Error ? exception.message : "Unhandled error");

        this.logging.add({
          id: randomUUID(),
          direction: "incoming",
          correlationId:
            (request.headers?.["x-correlation-id"] as string | undefined) ??
            randomUUID(),
          timestamp: new Date().toISOString(),
          method: (request.method ?? "GET").toUpperCase(),
          path: request.originalUrl ?? request.url ?? "/",
          statusCode,
          durationMs: 0,
          requestHeaders: redactHeaders(request.headers, this.options.redactHeaders),
          requestBody: this.options.captureRequestBody
            ? clampBody(request.body, this.options.maxBodySizeBytes)
            : undefined,
          responseBody: this.options.captureResponseBody
            ? clampBody(detail, this.options.maxBodySizeBytes)
            : undefined,
          errorMessage,
          errorStack: exception instanceof Error ? exception.stack : undefined,
          remoteAddress: request.ip
        });
      }
    }

    super.catch(exception, host);
  }
}
