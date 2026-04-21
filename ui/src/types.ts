export interface TrafficLogEntry {
  id: string;
  direction: "incoming" | "outgoing";
  correlationId: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  requestHeaders: Record<string, unknown>;
  requestBody?: unknown;
  responseBody?: unknown;
  errorMessage?: string;
  errorStack?: string;
  remoteAddress?: string;
}

export type ConsoleLogLevel = "log" | "warn" | "error" | "info" | "debug" | "trace";

export interface ConsoleLogEntry {
  id: string;
  level: ConsoleLogLevel;
  message: string;
  timestamp: string;
  context?: string;
  stack?: string;
  args?: unknown[];
}

export interface TrafficDeskConfig {
  dataPath: string;
  websocketNamespace: string;
  ignorePaths: string[];
  /** Subset of ignorePaths that can be removed via the UI (runtime-added). Omitted by older servers → UI treats all as removable. */
  dynamicIgnorePaths?: string[];
}

export interface FilterState {
  q: string;
  methods: string[];
  status: string;
  direction: "all" | "incoming" | "outgoing";
  durationMin: number;
  durationMax: number;
}

export interface ConsoleFilterState {
  q: string;
  levels: ConsoleLogLevel[];
}
