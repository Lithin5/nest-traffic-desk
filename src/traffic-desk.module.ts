import { DynamicModule, Global, Module, NestModule } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { TRAFFIC_DESK_OPTIONS, TRAFFIC_DESK_STORE } from "./constants";
import {
  defaultTrafficDeskOptions,
  ResolvedTrafficDeskModuleOptions,
  TrafficDeskModuleOptions
} from "./types/traffic-desk-options";
import { InMemoryRingBufferStore } from "./storage/in-memory-ring-buffer.store";
import { FileTrafficLogStore } from "./storage/file-traffic-log.store";
import { TrafficLoggingService } from "./traffic-logging.service";
import { TrafficInterceptor } from "./traffic.interceptor";
import { TrafficDeskGateway } from "./traffic-desk.gateway";
import { TrafficHttpBinding } from "./traffic-http.binding";
import { OutgoingHttpInstrumentation } from "./outgoing-http.instrumentation";
import { join } from "path";

@Global()
@Module({})
export class NestTrafficDeskModule implements NestModule {
  configure(): void {
    // Reserved for future middleware-based route protection hooks.
  }

  static register(options: TrafficDeskModuleOptions = {}): DynamicModule {
    const merged = {
      ...defaultTrafficDeskOptions,
      ...options
    } as ResolvedTrafficDeskModuleOptions;

    // When disabled, return a no-op module — no interceptors, no gateway,
    // no HTTP routes, no WebSocket are registered at all.
    if (merged.enabled === false) {
      return { module: NestTrafficDeskModule };
    }

    return {
      module: NestTrafficDeskModule,
      providers: [
        {
          provide: TRAFFIC_DESK_OPTIONS,
          useValue: merged
        },
        {
          provide: TRAFFIC_DESK_STORE,
          useFactory: () => {
            if (options.storeFactory) {
              return options.storeFactory();
            }

            if (merged.storage.type === "file") {
              return new FileTrafficLogStore({
                maxEntries: merged.maxEntries,
                filePath: merged.storage.filePath ?? join(process.cwd(), "traffic-desk.log.jsonl"),
                maxFileSizeBytes: merged.storage.maxFileSizeBytes ?? 5 * 1024 * 1024,
                maxFiles: merged.storage.maxFiles ?? 3
              });
            }

            return new InMemoryRingBufferStore(merged.maxEntries);
          }
        },
        TrafficDeskGateway,
        TrafficLoggingService,
        OutgoingHttpInstrumentation,
        TrafficHttpBinding,
        {
          provide: APP_INTERCEPTOR,
          useClass: TrafficInterceptor
        }
      ],
      exports: [TRAFFIC_DESK_OPTIONS, TRAFFIC_DESK_STORE, TrafficLoggingService]
    };
  }
}
