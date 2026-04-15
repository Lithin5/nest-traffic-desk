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
    private readonly gateway: TrafficDeskGateway
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
        this.logger.warn(`[Excluded] ${entry.method} ${entry.path} ${entry.statusCode} - would have been logged as error`);
      }
      return;
    }

    this.store.add(entry);
    this.gateway.broadcastNewEntry(entry);
  }

  isExcluded(path: string): boolean {
    if (this.options.ignorePaths.some((ignored) => path.startsWith(ignored))) {
      return true;
    }
    for (const ignored of this.dynamicIgnorePaths) {
      if (path.startsWith(ignored)) return true;
    }
    return false;
  }

  addIgnorePath(path: string): void {
    this.dynamicIgnorePaths.add(path);
  }

  removeIgnorePath(path: string): void {
    this.dynamicIgnorePaths.delete(path);
  }

  getIgnorePaths(): string[] {
    return [
      ...this.options.ignorePaths,
      ...Array.from(this.dynamicIgnorePaths)
    ];
  }

  query(filters: TrafficFilterQuery): { total: number; filteredCount: number; items: TrafficLogEntry[] } {
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
      const delta = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return filters.sort === "asc" ? delta : -delta;
    });

    if (filters.limit && filters.limit > 0) {
      rows = rows.slice(0, filters.limit);
    }

    return {
      total: all.length,
      filteredCount: rows.length,
      items: rows
    };
  }
}
