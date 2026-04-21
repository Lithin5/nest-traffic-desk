import { TrafficLogStore } from "../storage/traffic-log-store";

export interface FileStorageOptions {
  type: "file";
  filePath?: string;
  maxFileSizeBytes?: number;
  maxFiles?: number;
}

export interface MemoryStorageOptions {
  type: "memory";
}

export type TrafficDeskStorageOptions = MemoryStorageOptions | FileStorageOptions;

export interface TrafficDeskModuleOptions {
  enabled?: boolean;
  maxEntries?: number;
  maxBodySizeBytes?: number;
  captureRequestBody?: boolean;
  captureResponseBody?: boolean;
  redactHeaders?: string[];
  enableOutgoingHttp?: boolean;
  captureConsoleLogs?: boolean;
  /** Uncaught exceptions and unhandled promise rejections → console log store / UI */
  captureRuntimeErrors?: boolean;
  maxConsoleEntries?: number;
  uiBasePath?: string;
  dataPath?: string;
  uiDistPath?: string;
  enableUi?: boolean;
  enableWebsocket?: boolean;
  websocketNamespace?: string;
  ignorePaths?: string[];
  /** @deprecated Use ignorePaths instead. Kept for backward compatibility with "exclude" terminology. */
  excludePaths?: string[];
  storage?: TrafficDeskStorageOptions;
  storeFactory?: () => TrafficLogStore;
}

export type ResolvedTrafficDeskModuleOptions = Omit<
  Required<TrafficDeskModuleOptions>,
  "storeFactory" | "excludePaths"
> & {
  storeFactory?: () => TrafficLogStore;
  excludePaths?: string[]; // kept for runtime checks in interceptor
};

export const defaultTrafficDeskOptions: ResolvedTrafficDeskModuleOptions = {
  enabled: true,
  maxEntries: 1000,
  maxBodySizeBytes: 16_384,
  captureRequestBody: true,
  captureResponseBody: true,
  redactHeaders: ["authorization", "cookie", "set-cookie", "x-api-key"],
  enableOutgoingHttp: false,
  captureConsoleLogs: true,
  captureRuntimeErrors: true,
  maxConsoleEntries: 1000,
  uiBasePath: "/_logs",
  dataPath: "/_logs/data",
  uiDistPath: "",
  enableUi: true,
  enableWebsocket: true,
  websocketNamespace: "/",
  ignorePaths: ["/_logs", "/_logs/data", "/socket.io"],
  excludePaths: [],
  storage: {
    type: "memory"
  }
};
