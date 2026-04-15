export type TrafficDirection = "incoming" | "outgoing";

export interface TrafficLogEntry {
  id: string;
  direction: TrafficDirection;
  correlationId: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  requestHeaders: Record<string, unknown>;
  requestBody?: unknown;
  responseBody?: unknown;
  remoteAddress?: string;
}
