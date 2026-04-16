import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { TRAFFIC_DESK_CONSOLE_STORE, TRAFFIC_DESK_OPTIONS } from "./constants";
import { ResolvedTrafficDeskModuleOptions } from "./types/traffic-desk-options";
import { ConsoleLogStore } from "./storage/console-log-store";
import { TrafficDeskGateway } from "./traffic-desk.gateway";
import { ConsoleLogLevel } from "./types/console-log-entry";
import * as util from "util";
import { randomUUID } from "crypto";

@Injectable()
export class ConsoleInstrumentation implements OnModuleInit, OnModuleDestroy {
  private originalLog = console.log;
  private originalError = console.error;
  private originalWarn = console.warn;
  private originalInfo = console.info;
  private originalDebug = console.debug;
  private originalTrace = console.trace;
  
  private isInstrumented = false;

  constructor(
    @Inject(TRAFFIC_DESK_CONSOLE_STORE)
    private readonly store: ConsoleLogStore,
    @Inject(TRAFFIC_DESK_OPTIONS)
    private readonly options: ResolvedTrafficDeskModuleOptions,
    private readonly gateway: TrafficDeskGateway
  ) {}

  onModuleInit(): void {
    if (this.options.captureConsoleLogs) {
      this.instrument();
      this.gateway.setConsoleSnapshotProvider(() => this.store.getAll());
    }
  }

  onModuleDestroy(): void {
    this.restore();
  }

  private instrument(): void {
    if (this.isInstrumented) return;

    console.log = this.createHook("log", this.originalLog);
    console.error = this.createHook("error", this.originalError);
    console.warn = this.createHook("warn", this.originalWarn);
    console.info = this.createHook("info", this.originalInfo);
    console.debug = this.createHook("debug", this.originalDebug);
    console.trace = this.createHook("trace", this.originalTrace);

    this.isInstrumented = true;
  }

  private restore(): void {
    if (!this.isInstrumented) return;

    console.log = this.originalLog;
    console.error = this.originalError;
    console.warn = this.originalWarn;
    console.info = this.originalInfo;
    console.debug = this.originalDebug;
    console.trace = this.originalTrace;

    this.isInstrumented = false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createHook(level: ConsoleLogLevel, originalFn: (...args: any[]) => void) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (...args: any[]) => {
      originalFn.apply(console, args);
      
      try {
        const message = util.format(...args);
        
        let stack: string | undefined;
        // Collect stack trace
        const errObj = new Error();
        Error.captureStackTrace(errObj, originalFn);
        stack = errObj.stack;

        // Try to safely include original args, but stringify complex ones to avoid socket crashes
        const safeArgs = args.map(arg => {
          if (arg instanceof Error) return { message: arg.message, stack: arg.stack, name: arg.name };
          if (typeof arg === 'function') return '[Function]';
          try {
            JSON.stringify(arg);
            return arg;
          } catch {
            return util.inspect(arg, { depth: 2 });
          }
        });

        const entry = {
          id: randomUUID(),
          level,
          message,
          timestamp: new Date().toISOString(),
          stack,
          args: safeArgs
        };
        
        this.store.add(entry);
        this.gateway.broadcastConsoleEntry(entry);
      } catch (err) {
        // Safe fallback if format fails
      }
    };
  }
}
