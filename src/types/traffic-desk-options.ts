export interface TrafficDeskModuleOptions {
  enabled?: boolean;
  maxEntries?: number;
  maxBodySizeBytes?: number;
  captureRequestBody?: boolean;
  captureResponseBody?: boolean;
  redactHeaders?: string[];
  uiBasePath?: string;
  dataPath?: string;
  uiDistPath?: string;
  enableUi?: boolean;
  enableWebsocket?: boolean;
  websocketNamespace?: string;
  ignorePaths?: string[];
}

export const defaultTrafficDeskOptions: Required<TrafficDeskModuleOptions> = {
  enabled: true,
  maxEntries: 1000,
  maxBodySizeBytes: 16_384,
  captureRequestBody: true,
  captureResponseBody: true,
  redactHeaders: ["authorization", "cookie", "set-cookie", "x-api-key"],
  uiBasePath: "/_logs",
  dataPath: "/_logs/data",
  uiDistPath: "",
  enableUi: true,
  enableWebsocket: true,
  websocketNamespace: "/",
  ignorePaths: ["/_logs", "/_logs/data", "/socket.io"]
};
