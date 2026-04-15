import { useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import { JsonViewer } from "./components/JsonViewer";
import { FilterState, TrafficDeskConfig, TrafficLogEntry } from "./types";

const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function methodClass(method: string): string {
  return `method-pill method-${method.toLowerCase()}`;
}

function statusClass(statusCode: number): string {
  return `status-pill status-${Math.floor(statusCode / 100)}xx`;
}

function matchesFilters(entry: TrafficLogEntry, filters: FilterState): boolean {
  const q = filters.q.trim().toLowerCase();
  if (q && !entry.path.toLowerCase().includes(q)) {
    return false;
  }

  if (filters.methods.length > 0 && !filters.methods.includes(entry.method.toUpperCase())) {
    return false;
  }

  if (filters.status.trim().length > 0) {
    const status = filters.status.trim().toLowerCase();
    if (/^\dxx$/.test(status)) {
      if (Math.floor(entry.statusCode / 100) !== Number(status[0])) {
        return false;
      }
    } else if (/^\d{3}$/.test(status)) {
      if (entry.statusCode !== Number(status)) {
        return false;
      }
    }
  }

  return true;
}

async function fetchConfig(): Promise<TrafficDeskConfig> {
  const response = await fetch("./config");
  if (!response.ok) {
    throw new Error("Failed to load UI configuration.");
  }
  return response.json();
}

export function App() {
  const [config, setConfig] = useState<TrafficDeskConfig | null>(null);
  const [allLogs, setAllLogs] = useState<TrafficLogEntry[]>([]);
  const [filters, setFilters] = useState<FilterState>({ q: "", methods: [], status: "" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<"desc" | "asc">("desc");
  const [isLoading, setIsLoading] = useState(true);
  const [connectionState, setConnectionState] = useState<"connected" | "reconnecting" | "error">(
    "reconnecting"
  );
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  useEffect(() => {
    let socket: Socket | null = null;

    (async () => {
      try {
        const loadedConfig = await fetchConfig();
        setConfig(loadedConfig);
        const dataResponse = await fetch(`${loadedConfig.dataPath}?sort=desc`);
        const data = await dataResponse.json();
        setAllLogs(data.items ?? []);
        setIsLoading(false);

        socket = io(loadedConfig.websocketNamespace || "/", {
          transports: ["websocket", "polling"],
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 750,
          reconnectionDelayMax: 5000,
          randomizationFactor: 0.25
        });

        socket.on("connect", () => {
          setConnectionState("connected");
          setReconnectAttempt(0);
        });
        socket.on("disconnect", () => setConnectionState("reconnecting"));
        socket.io.on("reconnect_attempt", (attempt) => {
          setConnectionState("reconnecting");
          setReconnectAttempt(attempt);
        });
        socket.on("connect_error", () => setConnectionState("error"));
        socket.on("traffic:snapshot", (snapshot: TrafficLogEntry[]) => {
          setAllLogs(snapshot ?? []);
        });
        socket.on("traffic:new", (entry: TrafficLogEntry) => {
          setAllLogs((prev) => [entry, ...prev]);
        });
      } catch {
        setConnectionState("error");
        setIsLoading(false);
      }
    })();

    return () => {
      socket?.close();
    };
  }, []);

  const filteredLogs = useMemo(() => {
    const rows = allLogs.filter((entry) => matchesFilters(entry, filters));
    rows.sort((a, b) => {
      const delta = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return sort === "asc" ? delta : -delta;
    });
    return rows;
  }, [allLogs, filters, sort]);

  useEffect(() => {
    if (selectedId && !filteredLogs.some((row) => row.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filteredLogs, selectedId]);

  const selectedLog = filteredLogs.find((entry) => entry.id === selectedId) ?? null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Traffic Desk</h1>
          <p>Live HTTP request stream for your NestJS app</p>
        </div>
        <div className={`ws-state ws-${connectionState}`}>
          <span className="status-dot" />
          {connectionState === "connected" && "Connected"}
          {connectionState === "reconnecting" &&
            `Reconnecting${reconnectAttempt > 0 ? ` (attempt ${reconnectAttempt})` : ""}`}
          {connectionState === "error" && "Connection error"}
        </div>
      </header>

      <section className="filter-bar" aria-label="Log filters">
        <label>
          Search path
          <input
            type="search"
            placeholder="Search path..."
            value={filters.q}
            onChange={(e) => setFilters((current) => ({ ...current, q: e.target.value }))}
          />
        </label>

        <div className="method-group">
          <span>Methods</span>
          <div className="chips">
            {ALL_METHODS.map((method) => {
              const active = filters.methods.includes(method);
              return (
                <button
                  key={method}
                  type="button"
                  className={active ? "chip active" : "chip"}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      methods: active
                        ? current.methods.filter((item) => item !== method)
                        : [...current.methods, method]
                    }))
                  }
                >
                  {method}
                </button>
              );
            })}
          </div>
        </div>

        <label>
          Status
          <input
            type="text"
            inputMode="numeric"
            placeholder="All statuses (e.g. 4xx, 500)"
            value={filters.status}
            onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value }))}
          />
        </label>

        <button
          type="button"
          className="clear-btn"
          onClick={() => setFilters({ q: "", methods: [], status: "" })}
        >
          Clear filters
        </button>
      </section>

      <section className="result-bar">
        Showing {filteredLogs.length} of {allLogs.length} logs
        <button
          type="button"
          className="ghost-btn"
          onClick={() => setSort((current) => (current === "asc" ? "desc" : "asc"))}
        >
          Sort: {sort === "asc" ? "Oldest first" : "Newest first"}
        </button>
      </section>

      <main className="workspace">
        <section className="table-wrap" aria-live="polite">
          {isLoading && <div className="empty-state">Loading logs...</div>}
          {!isLoading && filteredLogs.length === 0 && (
            <div className="empty-state">No logs match your filters.</div>
          )}
          {!isLoading && filteredLogs.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Method</th>
                  <th>Direction</th>
                  <th>Path</th>
                  <th>Status</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((entry) => (
                  <tr
                    key={entry.id}
                    className={entry.id === selectedId ? "selected-row" : ""}
                    onClick={() => setSelectedId(entry.id)}
                  >
                    <td>{new Date(entry.timestamp).toLocaleTimeString()}</td>
                    <td>
                      <span className={methodClass(entry.method)}>{entry.method}</span>
                    </td>
                    <td>{entry.direction}</td>
                    <td className="path-cell">{entry.path}</td>
                    <td>
                      <span className={statusClass(entry.statusCode)}>{entry.statusCode}</span>
                    </td>
                    <td>{entry.durationMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <aside className="details-pane">
          {!selectedLog && <div className="empty-state">Select a row to inspect full details.</div>}
          {selectedLog && (
            <>
              <div className="detail-head">
                <h3>{selectedLog.method} {selectedLog.path}</h3>
                <p>
                  <span>{selectedLog.direction}</span>
                  <span>{new Date(selectedLog.timestamp).toLocaleString()}</span>
                  <span>{selectedLog.durationMs} ms</span>
                  <span>Status {selectedLog.statusCode}</span>
                </p>
              </div>

              <JsonViewer data={selectedLog.requestHeaders} title="Request Headers" />
              <JsonViewer data={selectedLog.requestBody ?? { message: "Not captured" }} title="Request Body" />
              <JsonViewer data={selectedLog.responseBody ?? { message: "Not captured" }} title="Response Body" />
            </>
          )}
        </aside>
      </main>

      {!config && !isLoading && (
        <div className="empty-state danger">
          Dashboard configuration endpoint is unavailable.
        </div>
      )}
    </div>
  );
}
