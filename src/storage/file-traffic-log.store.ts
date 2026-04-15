import { mkdirSync, existsSync, readFileSync, appendFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { Injectable, Logger } from "@nestjs/common";
import { TrafficLogStore } from "./traffic-log-store";
import { TrafficLogEntry } from "../types/traffic-log-entry";

interface FileTrafficLogStoreOptions {
  maxEntries: number;
  filePath: string;
  maxFileSizeBytes: number;
  maxFiles: number;
}

@Injectable()
export class FileTrafficLogStore implements TrafficLogStore {
  private readonly logger = new Logger(FileTrafficLogStore.name);
  private readonly entries: TrafficLogEntry[] = [];
  private readonly basePath: string;

  constructor(private readonly options: FileTrafficLogStoreOptions) {
    this.basePath = resolve(options.filePath);
    this.ensureDirectory();
    this.loadFromDisk();
  }

  add(entry: TrafficLogEntry): void {
    const line = `${JSON.stringify(entry)}\n`;
    this.rotateIfNeeded(Buffer.byteLength(line, "utf-8"));
    appendFileSync(this.basePath, line, "utf-8");

    this.entries.push(entry);
    this.trimToMaxEntries();
  }

  getAll(): TrafficLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;

    if (existsSync(this.basePath)) {
      writeFileSync(this.basePath, "", "utf-8");
    }

    for (let i = 1; i <= this.options.maxFiles; i += 1) {
      const archivePath = this.archivePath(i);
      if (existsSync(archivePath)) {
        rmSync(archivePath, { force: true });
      }
    }
  }

  count(): number {
    return this.entries.length;
  }

  private ensureDirectory(): void {
    mkdirSync(dirname(this.basePath), { recursive: true });
  }

  private loadFromDisk(): void {
    const files: string[] = [];
    for (let i = this.options.maxFiles; i >= 1; i -= 1) {
      const archive = this.archivePath(i);
      if (existsSync(archive)) {
        files.push(archive);
      }
    }
    if (existsSync(this.basePath)) {
      files.push(this.basePath);
    }

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      if (!content.trim()) {
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        try {
          this.entries.push(JSON.parse(trimmed) as TrafficLogEntry);
        } catch {
          this.logger.warn(`Skipping malformed log line in ${file}`);
        }
      }
    }

    this.trimToMaxEntries();
  }

  private trimToMaxEntries(): void {
    if (this.entries.length <= this.options.maxEntries) {
      return;
    }

    const overflow = this.entries.length - this.options.maxEntries;
    this.entries.splice(0, overflow);
  }

  private rotateIfNeeded(nextLineSizeBytes: number): void {
    if (!existsSync(this.basePath)) {
      return;
    }

    const currentSize = statSync(this.basePath).size;
    if (currentSize + nextLineSizeBytes <= this.options.maxFileSizeBytes) {
      return;
    }

    const oldest = this.archivePath(this.options.maxFiles);
    if (existsSync(oldest)) {
      rmSync(oldest, { force: true });
    }

    for (let i = this.options.maxFiles - 1; i >= 1; i -= 1) {
      const source = this.archivePath(i);
      if (!existsSync(source)) {
        continue;
      }

      renameSync(source, this.archivePath(i + 1));
    }

    renameSync(this.basePath, this.archivePath(1));
  }

  private archivePath(index: number): string {
    return `${this.basePath}.${index}`;
  }
}
