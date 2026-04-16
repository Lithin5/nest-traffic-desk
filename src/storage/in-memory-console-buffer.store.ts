import { ConsoleLogStore } from "./console-log-store";
import { ConsoleLogEntry } from "../types/console-log-entry";

export class InMemoryConsoleBufferStore implements ConsoleLogStore {
  private buffer: ConsoleLogEntry[] = [];

  constructor(private readonly maxEntries: number = 1000) {}

  add(entry: ConsoleLogEntry): void {
    if (this.buffer.length >= this.maxEntries) {
      this.buffer.shift();
    }
    this.buffer.push(entry);
  }

  getAll(): ConsoleLogEntry[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer = [];
  }
}
