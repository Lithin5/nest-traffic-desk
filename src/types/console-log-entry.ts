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
