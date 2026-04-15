import { DynamicModule, Global, Module, NestModule } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { TRAFFIC_DESK_OPTIONS, TRAFFIC_DESK_STORE } from "./constants";
import { defaultTrafficDeskOptions, TrafficDeskModuleOptions } from "./types/traffic-desk-options";
import { InMemoryRingBufferStore } from "./storage/in-memory-ring-buffer.store";
import { TrafficLoggingService } from "./traffic-logging.service";
import { TrafficInterceptor } from "./traffic.interceptor";
import { TrafficDeskGateway } from "./traffic-desk.gateway";
import { TrafficHttpBinding } from "./traffic-http.binding";

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
    } as Required<TrafficDeskModuleOptions>;

    return {
      module: NestTrafficDeskModule,
      providers: [
        {
          provide: TRAFFIC_DESK_OPTIONS,
          useValue: merged
        },
        {
          provide: TRAFFIC_DESK_STORE,
          useFactory: () => new InMemoryRingBufferStore(merged.maxEntries)
        },
        TrafficDeskGateway,
        TrafficLoggingService,
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
