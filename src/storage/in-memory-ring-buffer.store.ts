import { Injectable } from "@nestjs/common";
import { TrafficLogStore } from "./traffic-log-store";
import { TrafficLogEntry } from "../types/traffic-log-entry";

@Injectable()
export class InMemoryRingBufferStore implements TrafficLogStore {
  private readonly entries: TrafficLogEntry[] = [];

  constructor(private readonly maxEntries: number) {}

  add(entry: TrafficLogEntry): void {
    if (this.entries.length >= this.maxEntries) {
      this.entries.shift();
    }

    this.entries.push(entry);
  }

  getAll(): TrafficLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
  }

  count(): number {
    return this.entries.length;
  }
}
