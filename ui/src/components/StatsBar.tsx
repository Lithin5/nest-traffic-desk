import { useMemo } from "react";
import { TrafficLogEntry } from "../types";

interface Props {
  logs: TrafficLogEntry[];
}

export function StatsBar({ logs }: Props) {
  const stats = useMemo(() => {
    if (logs.length === 0) {
      return { total: 0, errorRate: 0, avgDuration: 0, incoming: 0, outgoing: 0 };
    }
    const errors = logs.filter((l) => l.statusCode >= 400).length;
    const totalDuration = logs.reduce((sum, l) => sum + l.durationMs, 0);
    const incoming = logs.filter((l) => l.direction === "incoming").length;
    const outgoing = logs.filter((l) => l.direction === "outgoing").length;
    return {
      total: logs.length,
      errorRate: Math.round((errors / logs.length) * 100),
      avgDuration: Math.round(totalDuration / logs.length),
      incoming,
      outgoing,
    };
  }, [logs]);

  return (
    <div className="stats-bar">
      <div className="stat-chip">
        <span className="stat-icon">⚡</span>
        <span className="stat-value">{stats.total}</span>
        <span className="stat-label">Total</span>
      </div>
      <div className={`stat-chip${stats.errorRate > 0 ? " stat-chip--danger" : ""}`}>
        <span className="stat-icon">⚠</span>
        <span className="stat-value">{stats.errorRate}%</span>
        <span className="stat-label">Errors</span>
      </div>
      <div className="stat-chip">
        <span className="stat-icon">⏱</span>
        <span className="stat-value">{stats.avgDuration} ms</span>
        <span className="stat-label">Avg</span>
      </div>
      <div className="stat-chip stat-chip--in">
        <span className="stat-icon">↓</span>
        <span className="stat-value">{stats.incoming}</span>
        <span className="stat-label">In</span>
      </div>
      <div className="stat-chip stat-chip--out">
        <span className="stat-icon">↑</span>
        <span className="stat-value">{stats.outgoing}</span>
        <span className="stat-label">Out</span>
      </div>
    </div>
  );
}
