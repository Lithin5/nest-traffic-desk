import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { TRAFFIC_DESK_OPTIONS, TRAFFIC_DESK_STORE } from "./constants";
import { ResolvedTrafficDeskModuleOptions } from "./types/traffic-desk-options";
import { TrafficLogStore } from "./storage/traffic-log-store";
import { TrafficLogEntry } from "./types/traffic-log-entry";
import { TrafficFilterQuery } from "./types/traffic-filter-query";
import { TrafficDeskGateway } from "./traffic-desk.gateway";

@Injectable()
export class TrafficLoggingService implements OnModuleInit {
  private readonly logger = new Logger(TrafficLoggingService.name);

  constructor(
    @Inject(TRAFFIC_DESK_STORE)
    private readonly store: TrafficLogStore,
    @Inject(TRAFFIC_DESK_OPTIONS)
    private readonly options: ResolvedTrafficDeskModuleOptions,
    private readonly gateway: TrafficDeskGateway,
  ) {}

  private readonly dynamicIgnorePaths = new Set<string>();

  onModuleInit(): void {
    this.gateway.setSnapshotProvider(() => this.store.getAll());
  }

  add(entry: TrafficLogEntry): void {
    if (!this.options.enabled) {
      return;
    }

    if (this.isExcluded(entry.path)) {
      if (entry.statusCode >= 400) {
        this.logger.warn(
          `[Excluded] ${entry.method} ${entry.path} ${entry.statusCode} - would have been logged as error`,
        );
      }
      return;
    }

    this.store.add(entry);
    this.gateway.broadcastNewEntry(entry);
  }

  isExcluded(path: string): boolean {
    const rawPath = path ?? "";
    const normalizedPath = this.normalizeIgnorePath(rawPath);
    const candidates = [rawPath, normalizedPath].filter(Boolean);

    for (const ignored of this.getAllIgnorePaths()) {
      if (candidates.some((candidate) => candidate.startsWith(ignored))) {
        return true;
      }
    }

    return false;
  }

  addIgnorePath(path: string): void {
    const normalized = this.normalizeIgnorePath(path);
    if (!normalized) return;
    this.dynamicIgnorePaths.add(normalized);
  }

  removeIgnorePath(path: string): void {
    const normalized = this.normalizeIgnorePath(path);
    if (!normalized) return;
    this.dynamicIgnorePaths.delete(normalized);
  }

  getIgnorePaths(): string[] {
    return this.getAllIgnorePaths();
  }

  private getAllIgnorePaths(): string[] {
    const combined = [
      ...this.options.ignorePaths.map((path) => this.normalizeIgnorePath(path)),
      ...Array.from(this.dynamicIgnorePaths),
    ].filter(Boolean);
    return Array.from(new Set(combined));
  }

  private normalizeIgnorePath(path: string): string {
    const trimmed = (path ?? "").trim();
    if (!trimmed) return "";

    let normalized = trimmed;
    try {
      // Accept full URLs (e.g. http://host/api/foo) and keep only pathname.
      normalized =
        new URL(trimmed, "http://traffic-desk.local").pathname || trimmed;
    } catch {
      normalized = trimmed;
    }

    const withoutFragment = normalized.split("#")[0];
    const withoutQuery = withoutFragment.split("?")[0];
    if (!withoutQuery) return "";

    const withLeadingSlash = withoutQuery.startsWith("/")
      ? withoutQuery
      : `/${withoutQuery}`;

    if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")) {
      return withLeadingSlash.slice(0, -1);
    }

    return withLeadingSlash;
  }

  query(filters: TrafficFilterQuery): {
    total: number;
    filteredCount: number;
    items: TrafficLogEntry[];
  } {
    const all = this.store.getAll();
    let rows = all.filter((entry) => {
      if (filters.q) {
        const term = filters.q.toLowerCase();
        if (!entry.path.toLowerCase().includes(term)) {
          return false;
        }
      }

      if (filters.methods && filters.methods.length > 0) {
        const allowed = new Set(filters.methods.map((m) => m.toUpperCase()));
        if (!allowed.has(entry.method.toUpperCase())) {
          return false;
        }
      }

      if (filters.status !== undefined && entry.statusCode !== filters.status) {
        return false;
      }

      if (
        filters.statusClass !== undefined &&
        Math.floor(entry.statusCode / 100) !== filters.statusClass
      ) {
        return false;
      }

      return true;
    });

    rows = rows.sort((a, b) => {
      const delta =
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return filters.sort === "asc" ? delta : -delta;
    });

    if (filters.limit && filters.limit > 0) {
      rows = rows.slice(0, filters.limit);
    }

    return {
      total: all.length,
      filteredCount: rows.length,
      items: rows,
    };
  }
}
