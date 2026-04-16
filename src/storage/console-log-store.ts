import { ConsoleLogEntry } from "../types/console-log-entry";

export interface ConsoleLogStore {
  add(entry: ConsoleLogEntry): void;
  getAll(): ConsoleLogEntry[];
  clear(): void;
}
