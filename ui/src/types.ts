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
  remoteAddress?: string;
}

export interface TrafficDeskConfig {
  dataPath: string;
  websocketNamespace: string;
}

export interface FilterState {
  q: string;
  methods: string[];
  status: string;
  direction: "all" | "incoming" | "outgoing";
  durationMin: number;
  durationMax: number;
}
