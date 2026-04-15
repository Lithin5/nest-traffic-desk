import { TrafficLogEntry } from "../types/traffic-log-entry";

export interface TrafficLogStore {
  add(entry: TrafficLogEntry): void;
  getAll(): TrafficLogEntry[];
  clear(): void;
  count(): number;
}
