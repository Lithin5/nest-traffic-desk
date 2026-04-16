import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { TabbedJsonViewer } from "./components/TabbedJsonViewer";
import { Paginator } from "./components/Paginator";
import { StatsBar } from "./components/StatsBar";
import { FilterState, TrafficDeskConfig, TrafficLogEntry, ConsoleLogEntry, ConsoleFilterState, ConsoleLogLevel } from "./types";

const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const DEFAULT_FILTERS: FilterState = {
  q: "",
  methods: [],
  status: "",
  direction: "all",
  durationMin: 0,
  durationMax: 0,
};

function methodClass(method: string) {
  return `method-pill method-${method.toLowerCase()}`;
}
function statusClass(statusCode: number) {
  return `status-pill status-${Math.floor(statusCode / 100)}xx`;
}
function chipClass(method: string, active: boolean) {
  return `chip chip-${method.toLowerCase()}${active ? " active" : ""}`;
}
function durationClass(ms: number) {
  if (ms >= 2000) return "duration-cell duration-very-slow";
  if (ms >= 800) return "duration-cell duration-slow";
  return "duration-cell";
}

function matchesFilters(entry: TrafficLogEntry, filters: FilterState): boolean {
  const q = filters.q.trim().toLowerCase();
  if (q && !entry.path.toLowerCase().includes(q)) return false;

  if (filters.methods.length > 0 && !filters.methods.includes(entry.method.toUpperCase()))
    return false;

  if (filters.status.trim().length > 0) {
    const s = filters.status.trim().toLowerCase();
    if (/^\dxx$/.test(s)) {
      if (Math.floor(entry.statusCode / 100) !== Number(s[0])) return false;
    } else if (/^\d{3}$/.test(s)) {
      if (entry.statusCode !== Number(s)) return false;
    }
  }

  if (filters.direction !== "all" && entry.direction !== filters.direction) return false;

  if (filters.durationMin > 0 && entry.durationMs < filters.durationMin) return false;
  if (filters.durationMax > 0 && entry.durationMs > filters.durationMax) return false;

  return true;
}

async function fetchConfig(): Promise<TrafficDeskConfig> {
  const res = await fetch("./config");
  if (!res.ok) throw new Error("Failed to load UI configuration.");
  return res.json();
}

function exportLogs(logs: TrafficLogEntry[]) {
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `traffic-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const SKELETON_ROWS = 6;

export function App() {
  const [config, setConfig] = useState<TrafficDeskConfig | null>(null);
  const [viewMode, setViewMode] = useState<"traffic" | "console">("traffic");
  const [allConsoleLogs, setAllConsoleLogs] = useState<ConsoleLogEntry[]>([]);
  const [consoleFilters, setConsoleFilters] = useState<ConsoleFilterState>({ q: "", levels: [] });
  const [allLogs, setAllLogs] = useState<TrafficLogEntry[]>([]);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedConsoleId, setSelectedConsoleId] = useState<string | null>(null);
  const [sort, setSort] = useState<"desc" | "asc">("desc");
  const [isLoading, setIsLoading] = useState(true);
  const [connectionState, setConnectionState] = useState<"connected" | "reconnecting" | "error">(
    "reconnecting"
  );
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("td-theme") as "light" | "dark") ?? "light"
  );
  const [showExclusions, setShowExclusions] = useState(false);
  const [newExcludePath, setNewExcludePath] = useState("");
  const [comments, setComments] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("td-comments") || "{}"); } catch { return {}; }
  });

  useEffect(() => {
    localStorage.setItem("td-comments", JSON.stringify(comments));
  }, [comments]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("td-theme", theme);
  }, [theme]);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const sortRef = useRef(sort);
  sortRef.current = sort;

  // Keyboard navigation
  const filteredLogsRef = useRef<TrafficLogEntry[]>([]);

  useEffect(() => {
    let socket: Socket | null = null;
    let cancelled = false;

    (async () => {
      try {
        const loadedConfig = await fetchConfig();
        if (cancelled) return;
        setConfig(loadedConfig);
        const dataRes = await fetch(`${loadedConfig.dataPath}?sort=desc`);
        const data = await dataRes.json();
        if (cancelled) return;
        setAllLogs(data.items ?? []);
        setIsLoading(false);

        const ns = (loadedConfig.websocketNamespace || "/").trim() || "/";
        const socketOpts = {
          transports: ["websocket", "polling"] as const,
          path: "/socket.io",
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 750,
          reconnectionDelayMax: 5000,
          randomizationFactor: 0.25
        };

        // Default namespace: use io(opts) so the client resolves the page origin (not io("/"), which
        // socket.io-client parses via a special URL path and can misbehave on some hosts).
        socket = ns === "/" ? io(socketOpts) : io(ns, socketOpts);

        socket.on("connect", () => { setConnectionState("connected"); setReconnectAttempt(0); });
        socket.on("disconnect", () => setConnectionState("reconnecting"));
        socket.io.on("reconnect_attempt", (attempt) => {
          setConnectionState("reconnecting");
          setReconnectAttempt(attempt);
        });
        socket.on("connect_error", () => setConnectionState("error"));
        socket.on("traffic:snapshot", (snapshot: TrafficLogEntry[]) => {
          if (!pausedRef.current) setAllLogs(snapshot ?? []);
        });
        socket.on("traffic:new", (entry: TrafficLogEntry) => {
          if (!pausedRef.current) {
            setAllLogs((prev) => [entry, ...prev]);
            setNewIds((prev) => {
              const next = new Set(prev);
              next.add(entry.id);
              setTimeout(() => setNewIds((s) => { const n = new Set(s); n.delete(entry.id); return n; }), 600);
              return next;
            });
            if (sortRef.current === "desc") setPage(1);
          }
        });
        socket.on("console:snapshot", (snapshot: ConsoleLogEntry[]) => {
          if (!pausedRef.current) setAllConsoleLogs(snapshot || []);
        });
        socket.on("console:new", (entry: ConsoleLogEntry) => {
          if (!pausedRef.current) {
            setAllConsoleLogs((prev) => [entry, ...prev]);
            setNewIds((prev) => {
              const next = new Set(prev);
              next.add(entry.id);
              setTimeout(() => setNewIds((s) => { const n = new Set(s); n.delete(entry.id); return n; }), 600);
              return next;
            });
          }
        });
      } catch {
        setConnectionState("error");
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, []);

  const filteredLogs = useMemo(() => {
    const rows = allLogs.filter((e) => matchesFilters(e, filters));
    rows.sort((a, b) => {
      const delta = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return sort === "asc" ? delta : -delta;
    });
    return rows;
  }, [allLogs, filters, sort]);

  const filteredConsoleLogs = useMemo(() => {
    const q = consoleFilters.q.trim().toLowerCase();
    const rows = allConsoleLogs.filter((e) => {
      if (q && !e.message.toLowerCase().includes(q) && !(e.context && e.context.toLowerCase().includes(q))) return false;
      if (consoleFilters.levels.length > 0 && !consoleFilters.levels.includes(e.level)) return false;
      return true;
    });
    rows.sort((a, b) => {
      const delta = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return sort === "asc" ? delta : -delta;
    });
    return rows;
  }, [allConsoleLogs, consoleFilters, sort]);

  filteredLogsRef.current = filteredLogs;

  // Reset to page 1 on filter/sort change
  useEffect(() => { setPage(1); }, [filters, sort]);

  // Deselect if filtered out
  useEffect(() => {
    if (selectedId && !filteredLogs.some((r) => r.id === selectedId)) setSelectedId(null);
  }, [filteredLogs, selectedId]);

  // Paginated slice
  const pagedLogs = useMemo(() => {
    if (pageSize === 0) return filteredLogs;
    const start = (page - 1) * pageSize;
    return filteredLogs.slice(start, start + pageSize);
  }, [filteredLogs, page, pageSize]);

  const selectedLog = filteredLogs.find((e) => e.id === selectedId) ?? null;
  const selectedConsoleLog = filteredConsoleLogs.find((e) => e.id === selectedConsoleId) ?? null;

  const derivedErrorSection = useMemo(() => {
    if (!selectedLog) return null;

    let message = selectedLog.errorMessage;

    if (!message && selectedLog.responseBody && typeof selectedLog.responseBody === "object") {
      const body = selectedLog.responseBody as Record<string, unknown>;
      const fromBody = (body.error ?? body.message) as unknown;
      if (fromBody !== undefined && fromBody !== null) {
        message = String(fromBody);
      }
    }

    if (!message) return null;

    return {
      title: "Error Info",
      data: {
        message,
        stack: selectedLog.errorStack,
      },
    } as const;
  }, [selectedLog]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const logs = filteredLogsRef.current;
      if (e.key === "Escape") {
        setSelectedId(null);
        setSelectedConsoleId(null);
        return;
      }
      if (e.key === "c" || e.key === "C") {
        if (viewMode === "traffic" && selectedId) {
          const entry = logs.find((l) => l.id === selectedId);
          if (entry) navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
        } else if (viewMode === "console" && selectedConsoleId) {
          const entry = filteredConsoleLogs.find(l => l.id === selectedConsoleId);
          if (entry) navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (viewMode === "traffic") {
          e.preventDefault();
          const idx = logs.findIndex((l) => l.id === selectedId);
          const next = e.key === "ArrowDown"
            ? Math.min(logs.length - 1, idx + 1)
            : Math.max(0, idx - 1);
          if (next >= 0 && next < logs.length) setSelectedId(logs[next].id);
        } else if (viewMode === "console") {
          e.preventDefault();
          const idx = filteredConsoleLogs.findIndex((l) => l.id === selectedConsoleId);
          const next = e.key === "ArrowDown"
            ? Math.min(filteredConsoleLogs.length - 1, idx + 1)
            : Math.max(0, idx - 1);
          if (next >= 0 && next < filteredConsoleLogs.length) setSelectedConsoleId(filteredConsoleLogs[next].id);
        }
      }
    },
    [selectedId, selectedConsoleId, viewMode, filteredConsoleLogs]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  function clearLogs() {
    setAllLogs([]);
    setSelectedId(null);
    setPage(1);
  }

  function toggleMethod(method: string) {
    setFilters((f) => ({
      ...f,
      methods: f.methods.includes(method)
        ? f.methods.filter((m) => m !== method)
        : [...f.methods, method],
    }));
  }

  async function blockPath(path: string) {
    if (!window.confirm(`Ignore all future requests starting with "${path}"?`))
      return;
    try {
      const res = await fetch("./ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (res.ok) {
        // Refresh config to update ignore list
        const loadedConfig = await fetchConfig();
        setConfig(loadedConfig);
      }
    } catch (err) {
      console.error("Failed to block path:", err);
    }
  }

  async function unblockPath(path: string) {
    try {
      const res = await fetch("./ignore", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (res.ok) {
        const loadedConfig = await fetchConfig();
        setConfig(loadedConfig);
      }
    } catch (err) {
      console.error("Failed to unblock path:", err);
    }
  }

  return (
    <div className="app-shell">
      {/* ── Top Bar ── */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="logo-badge">🚦</div>
          <div className="topbar-meta">
            <h1>Traffic Desk</h1>
            <p>Live HTTP request stream for your NestJS app</p>
          </div>
          <StatsBar logs={allLogs} />
        </div>

        <div className="topbar-right">
          {paused && (
            <span className="paused-badge">⏸ Paused</span>
          )}
          <button
            id="btn-pause"
            type="button"
            className={`topbar-btn${paused ? " topbar-btn--active" : ""}`}
            onClick={() => setPaused((v) => !v)}
            title={paused ? "Resume live updates" : "Pause live updates"}
          >
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <button
            id="btn-export"
            type="button"
            className="topbar-btn"
            onClick={() => exportLogs(filteredLogs)}
            title="Export filtered logs as JSON"
          >
            ⬇ Export
          </button>
          <button
            id="btn-clear"
            type="button"
            className="topbar-btn topbar-btn--danger"
            onClick={clearLogs}
            title="Clear all logs"
          >
            🗑 Clear
          </button>
          <button
            id="btn-ignored-paths"
            type="button"
            className={`topbar-btn${showExclusions ? " topbar-btn--active" : ""}`}
            onClick={() => setShowExclusions((v) => !v)}
            title="Manage ignored paths (exclude from logging)"
          >
            🚫 Ignored Paths {config?.ignorePaths?.length ? `(${config.ignorePaths.length})` : ""}
          </button>
          <button
            id="btn-theme"
            type="button"
            className="topbar-btn"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
          >
            {theme === "light" ? "☾ Dark" : "☀ Light"}
          </button>
          <div className={`ws-state ws-${connectionState}`}>
            <span className="status-dot" />
            {connectionState === "connected" && "Live"}
            {connectionState === "reconnecting" &&
              `Reconnecting${reconnectAttempt > 0 ? ` #${reconnectAttempt}` : ""}`}
            {connectionState === "error" && "Error"}
          </div>
        </div>
      </header>

      {/* ── Ignored Paths Manager ── */}
      {showExclusions && (
        <section className="exclusions-manager panel" style={{ padding: "1rem", borderRadius: "14px", border: "1px solid var(--border)", background: "var(--panel-alt)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <h2 style={{ fontSize: "1rem", margin: 0 }}>Ignored Paths</h2>
            <button className="ghost-btn" style={{ padding: "0.2rem 0.5rem" }} onClick={() => setShowExclusions(false)}>Close</button>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <input
              type="text"
              placeholder="/api/health, /metrics ..."
              value={newExcludePath}
              onChange={(e) => setNewExcludePath(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="topbar-btn" style={{ background: "var(--accent)", color: "white" }} onClick={() => { if (newExcludePath) { blockPath(newExcludePath); setNewExcludePath(""); } }}>Add Path</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {config?.ignorePaths?.map(path => (
              <div key={path} className="chip active" style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.3rem 0.7rem" }}>
                {path}
                <button
                  style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: "0.9rem" }}
                  onClick={() => unblockPath(path)}
                >
                  ✕
                </button>
              </div>
            ))}
            {(!config?.ignorePaths || config.ignorePaths.length === 0) && (
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>No paths are currently ignored. Error responses (4xx/5xx) will always be shown.</div>
            )}
          </div>
        </section>
      )}

      {/* ── View Tabs ── */}
      <div style={{ display: "flex", gap: "1rem", marginTop: "0.2rem", marginBottom: "0.2rem" }}>
        <button className={`chip ${viewMode === "traffic" ? "active" : ""}`} onClick={() => setViewMode("traffic")} style={{ fontSize: "0.85rem", padding: "0.3rem 0.8rem" }}>
          🚦 HTTP Traffic
        </button>
        <button className={`chip ${viewMode === "console" ? "active" : ""}`} onClick={() => setViewMode("console")} style={{ fontSize: "0.85rem", padding: "0.3rem 0.8rem" }}>
          🖥️ Console Logs {allConsoleLogs.length > 0 ? `(${allConsoleLogs.length})` : ""}
        </button>
      </div>

      {/* ── Filter Bar ── */}
      {viewMode === "traffic" ? (
        <section className="filter-bar" aria-label="Log filters">
          {/* Search */}
          <label className="filter-label">
            Search path
            <div className="input-wrapper">
              <span className="input-icon">🔍</span>
              <input
                id="filter-search"
                type="search"
                placeholder="Filter by path..."
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              />
            </div>
          </label>

          {/* Methods */}
          <div className="filter-label method-group">
            Methods
            <div className="chips">
              {ALL_METHODS.map((method) => {
                const active = filters.methods.includes(method);
                return (
                  <button
                    key={method}
                    id={`chip-${method.toLowerCase()}`}
                    type="button"
                    className={chipClass(method, active)}
                    onClick={() => toggleMethod(method)}
                  >
                    {method}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Status */}
          <label className="filter-label">
            Status
            <div className="input-wrapper">
              <span className="input-icon">🔢</span>
              <input
                id="filter-status"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 4xx, 500"
                value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              />
            </div>
          </label>

          {/* Direction */}
          <div className="filter-label direction-group">
            Direction
            <div className="dir-toggle">
              {(["all", "incoming", "outgoing"] as const).map((d) => (
                <button
                  key={d}
                  id={`dir-${d}`}
                  type="button"
                  className={`dir-btn${filters.direction === d ? " active" : ""}`}
                  onClick={() => setFilters((f) => ({ ...f, direction: d }))}
                >
                  {d === "all" ? "All" : d === "incoming" ? "↓ In" : "↑ Out"}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="filter-actions">
            <button
              id="btn-sort"
              type="button"
              className="ghost-btn"
              onClick={() => setSort((s) => (s === "asc" ? "desc" : "asc"))}
            >
              {sort === "asc" ? "↑ Oldest" : "↓ Newest"}
            </button>
            <button
              id="btn-clear-filters"
              type="button"
              className="clear-btn"
              onClick={() => setFilters(DEFAULT_FILTERS)}
            >
              ✕ Clear
            </button>
          </div>
        </section>
      ) : (
        <section className="filter-bar" aria-label="Console filters" style={{ gridTemplateColumns: "2fr 3fr auto" }}>
          <label className="filter-label">
            Search message / context
            <div className="input-wrapper">
              <span className="input-icon">🔍</span>
              <input
                type="search"
                placeholder="Filter console output..."
                value={consoleFilters.q}
                onChange={(e) => setConsoleFilters((f) => ({ ...f, q: e.target.value }))}
              />
            </div>
          </label>

          <div className="filter-label method-group">
            Levels
            <div className="chips">
              {(["log", "info", "warn", "error", "debug", "trace"] as ConsoleLogLevel[]).map((level) => {
                const active = consoleFilters.levels.includes(level);
                return (
                  <button
                    key={level}
                    type="button"
                    className={`chip ${active ? "active" : ""}`}
                    style={active ? {
                      background: level === "error" ? "var(--danger-bg)" : level === "warn" ? "var(--warning-bg)" : level === "info" ? "var(--info-bg)" : "var(--accent-dim)",
                      borderColor: level === "error" ? "rgba(225,29,72,0.4)" : level === "warn" ? "rgba(245,158,11,0.4)" : level === "info" ? "rgba(59,130,246,0.4)" : "var(--border-hover)",
                      color: level === "error" ? "var(--danger)" : level === "warn" ? "var(--warning)" : level === "info" ? "var(--info)" : "var(--accent)"
                    } : {}}
                    onClick={() => setConsoleFilters((f) => ({
                      ...f,
                      levels: f.levels.includes(level) ? f.levels.filter(l => l !== level) : [...f.levels, level]
                    }))}
                  >
                    {level.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="filter-actions" style={{ justifyContent: "flex-end" }}>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setSort((s) => (s === "asc" ? "desc" : "asc"))}
            >
              {sort === "asc" ? "↑ Oldest" : "↓ Newest"}
            </button>
            <button
              type="button"
              className="clear-btn"
              onClick={() => setConsoleFilters({ q: "", levels: [] })}
            >
              ✕ Clear
            </button>
          </div>
        </section>
      )}

      {/* ── Result Bar ── */}
      <div className="result-bar">
        <span>
          {viewMode === "traffic"
            ? (filteredLogs.length === allLogs.length ? `${allLogs.length} logs` : `${filteredLogs.length} of ${allLogs.length} logs`)
            : (filteredConsoleLogs.length === allConsoleLogs.length ? `${allConsoleLogs.length} logs` : `${filteredConsoleLogs.length} of ${allConsoleLogs.length} logs`)
          }
        </span>
        <span style={{ fontSize: "0.72rem", opacity: 0.55 }}>
          ↑ ↓ navigate · Esc close · C copy
        </span>
      </div>

      {/* ── Workspace ── */}
      <main className="workspace">
        {/* Log Table */}
        <section className="table-wrap" aria-live="polite">
          {viewMode === "traffic" ? (
            isLoading ? (
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Method</th>
                    <th>Dir</th>
                    <th>Path</th>
                    <th>Status</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                    <tr key={i} className="skeleton-row">
                      {[60, 54, 48, 200, 54, 60].map((w, j) => (
                        <td key={j}>
                          <div className="skeleton-cell" style={{ width: w }} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : filteredLogs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📭</div>
                <div>{allLogs.length === 0 ? "No logs yet. Waiting for traffic…" : "No logs match your filters."}</div>
              </div>
            ) : (
              <>
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Method</th>
                      <th>Dir</th>
                      <th>Path</th>
                      <th>Status</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedLogs.map((entry) => (
                      <tr
                        key={entry.id}
                        id={`row-${entry.id}`}
                        className={[
                          entry.id === selectedId ? "selected-row" : "",
                          newIds.has(entry.id) ? "row-new" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => setSelectedId(entry.id)}
                      >
                        <td style={{ whiteSpace: "nowrap", fontSize: "0.77rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          {new Date(entry.timestamp).toLocaleTimeString()}
                          {comments[entry.id] && <span title="Has comment" style={{ fontSize: "0.8rem" }}>📝</span>}
                        </td>
                        <td>
                          <span className={methodClass(entry.method)}>{entry.method}</span>
                        </td>
                        <td>
                          <span className={`dir-pill dir-pill-${entry.direction === "incoming" ? "in" : "out"}`}>
                            {entry.direction === "incoming" ? "↓" : "↑"}
                          </span>
                        </td>
                        <td className="path-cell">{entry.path}</td>
                        <td>
                          <span className={statusClass(entry.statusCode)}>{entry.statusCode}</span>
                        </td>
                        <td className={durationClass(entry.durationMs)}>
                          {entry.durationMs} ms
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <Paginator
                  page={page}
                  pageSize={pageSize}
                  total={filteredLogs.length}
                  onPage={setPage}
                  onPageSize={(s) => { setPageSize(s); setPage(1); }}
                />
              </>
            )) : viewMode === "console" ? (
              <div style={{ padding: "0.5rem", display: "flex", flexDirection: "column", flex: 1 }}>
                {filteredConsoleLogs.length === 0 && <div className="empty-state">No console logs intercepted.</div>}
                {filteredConsoleLogs.map((log) => (
                  <div key={log.id}
                    onClick={() => setSelectedConsoleId(log.id)}
                    style={{
                      padding: "0.75rem",
                      borderBottom: "1px solid var(--row-border)",
                      background: log.id === selectedConsoleId ? "rgba(45,212,191,0.07)" : "var(--bg-code)",
                      boxShadow: log.id === selectedConsoleId ? "inset 3px 0 0 var(--accent)" : "none",
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.8rem",
                      display: "flex",
                      gap: "1rem",
                      transition: "background var(--transition)",
                      cursor: "pointer"
                    }}>
                    <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span style={{
                      flexShrink: 0,
                      fontWeight: "bold",
                      width: "50px",
                      color: log.level === "error" ? "var(--danger)" : log.level === "warn" ? "var(--warning)" : log.level === "info" ? "var(--info)" : "var(--text-dim)"
                    }}>[{log.level.toUpperCase()}]</span>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      <span style={{ wordBreak: "break-word", whiteSpace: "pre-wrap", color: "var(--text)" }}>{log.message}</span>
                      {log.context && <span style={{ fontSize: "0.7rem", color: "var(--text-dim)", fontStyle: "italic" }}>Context: {log.context}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
            <div className="empty-state">
              Unknown view mode.
            </div>
          )}
        </section>

        {/* Detail Pane */}
        <aside className="details-pane">
          {viewMode === "traffic" ? (
            !selectedLog ? (
              <div className="empty-state">
                <div className="empty-state-icon">👆</div>
                <div>Select an HTTP log to inspect full details.</div>
                <div style={{ fontSize: "0.72rem" }}>Tip: use ↑ ↓ keys to navigate rows</div>
              </div>
            ) : (
              <>
                <div className="detail-head">
                  <div className="detail-head-top">
                    <h3>
                      <span className={methodClass(selectedLog.method)} style={{ marginRight: "0.5rem" }}>
                        {selectedLog.method}
                      </span>
                      {selectedLog.path}
                      <button
                        type="button"
                        className="ghost-btn"
                        style={{ marginLeft: "0.5rem", padding: "0.15rem 0.4rem", fontSize: "0.75rem" }}
                        onClick={() => navigator.clipboard.writeText(selectedLog.path)}
                        title="Copy endpoint path"
                      >
                        📋 Copy
                      </button>
                      <button
                        type="button"
                        className="block-btn"
                        onClick={() => blockPath(selectedLog.path)}
                        title="Add this path to exclusion list"
                      >
                        🚫 Block
                      </button>
                    </h3>
                    <button
                      type="button"
                      className="detail-close"
                      onClick={() => setSelectedId(null)}
                      title="Close (Esc)"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="detail-meta">
                    <span className="detail-meta-item">
                      <span className={statusClass(selectedLog.statusCode)}>{selectedLog.statusCode}</span>
                    </span>
                    <span className="detail-meta-item">{selectedLog.direction === "incoming" ? "↓ Incoming" : "↑ Outgoing"}</span>
                    <span className="detail-meta-item">{selectedLog.durationMs} ms</span>
                    <span className="detail-meta-item">{new Date(selectedLog.timestamp).toLocaleString()}</span>
                    {selectedLog.remoteAddress && (
                      <span className="detail-meta-item">🌐 {selectedLog.remoteAddress}</span>
                    )}
                  </div>
                </div>

                <div className="log-comment-section" style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", background: "var(--panel-alt, transparent)" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.4rem", color: "var(--text-dim)" }}>
                    📝 COMMENTS / NOTES
                  </label>
                  <textarea
                    value={comments[selectedLog.id] || ""}
                    onChange={(e) => setComments(prev => ({ ...prev, [selectedLog.id]: e.target.value }))}
                    placeholder="Add a note to this request..."
                    spellCheck={false}
                    style={{ width: "100%", minHeight: "56px", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg-code, rgba(0,0,0,0.1))", color: "var(--text-main)", resize: "vertical", fontFamily: "inherit", fontSize: "0.85rem", outline: "none" }}
                    onFocus={(e) => e.target.style.borderColor = "var(--accent)"}
                    onBlur={(e) => e.target.style.borderColor = "var(--border)"}
                  />
                </div>

                <TabbedJsonViewer
                  sections={[
                    { title: "Request Headers", data: selectedLog.requestHeaders },
                    ...(selectedLog.requestBody ? [{ title: "Request Body", data: selectedLog.requestBody }] : []),
                    ...(selectedLog.responseBody ? [{ title: "Response Body", data: selectedLog.responseBody }] : []),
                    ...(derivedErrorSection ? [derivedErrorSection] : []),
                  ].map(s => s.data ? s : { ...s, data: { message: "Not captured / empty" } })}
                />
              </>
            )
          ) : (
            !selectedConsoleLog ? (
              <div className="empty-state">
                <div className="empty-state-icon">👆</div>
                <div>Select a console log to inspect details.</div>
                <div style={{ fontSize: "0.72rem" }}>Tip: use ↑ ↓ keys to navigate rows</div>
              </div>
            ) : (
              <>
                <div className="detail-head">
                  <div className="detail-head-top">
                    <h3>
                      <span style={{
                        marginRight: "0.5rem",
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "0.15rem 0.5rem",
                        borderRadius: "999px",
                        fontSize: "0.7rem",
                        fontWeight: "bold",
                        background: selectedConsoleLog.level === "error" ? "var(--danger-bg)" : selectedConsoleLog.level === "warn" ? "var(--warning-bg)" : selectedConsoleLog.level === "info" ? "var(--info-bg)" : "var(--accent-dim)",
                        color: selectedConsoleLog.level === "error" ? "var(--danger)" : selectedConsoleLog.level === "warn" ? "var(--warning)" : selectedConsoleLog.level === "info" ? "var(--info)" : "var(--text-muted)"
                      }}>
                        {selectedConsoleLog.level.toUpperCase()}
                      </span>
                      Console Output
                      <button
                        type="button"
                        className="ghost-btn"
                        style={{ marginLeft: "0.5rem", padding: "0.15rem 0.4rem", fontSize: "0.75rem" }}
                        onClick={() => navigator.clipboard.writeText(selectedConsoleLog.message)}
                        title="Copy message text"
                      >
                        📋 Copy
                      </button>
                    </h3>
                    <button
                      type="button"
                      className="detail-close"
                      onClick={() => setSelectedConsoleId(null)}
                      title="Close (Esc)"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="detail-meta">
                    <span className="detail-meta-item">{new Date(selectedConsoleLog.timestamp).toLocaleString()}</span>
                    {selectedConsoleLog.context && <span className="detail-meta-item">Context: {selectedConsoleLog.context}</span>}
                  </div>
                </div>

                <div className="log-comment-section" style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", background: "var(--panel-alt, transparent)" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.4rem", color: "var(--text-dim)" }}>
                    📝 COMMENTS / NOTES
                  </label>
                  <textarea
                    value={comments[selectedConsoleLog.id] || ""}
                    onChange={(e) => setComments(prev => ({ ...prev, [selectedConsoleLog.id]: e.target.value }))}
                    placeholder="Add a note to this console log..."
                    spellCheck={false}
                    style={{ width: "100%", minHeight: "56px", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg-code, rgba(0,0,0,0.1))", color: "var(--text-main)", resize: "vertical", fontFamily: "inherit", fontSize: "0.85rem", outline: "none" }}
                    onFocus={(e) => e.target.style.borderColor = "var(--accent)"}
                    onBlur={(e) => e.target.style.borderColor = "var(--border)"}
                  />
                </div>

                <TabbedJsonViewer
                  sections={[
                    { title: "Message Text", data: { text: selectedConsoleLog.message } },
                    ...(selectedConsoleLog.args && selectedConsoleLog.args.length > 0 ? [{ title: "Arguments", data: selectedConsoleLog.args }] : []),
                    ...(selectedConsoleLog.stack ? [{ title: "Stack Trace", data: { stack: selectedConsoleLog.stack } }] : [])
                  ]}
                />
              </>
            )
          )}
        </aside>
      </main>

      {!config && !isLoading && (
        <div className="danger">
          Dashboard configuration endpoint is unavailable.
        </div>
      )}
    </div>
  );
}
