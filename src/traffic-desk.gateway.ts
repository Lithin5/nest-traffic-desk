import { Inject, Injectable, Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import {
  TRAFFIC_DESK_EVENT_NEW,
  TRAFFIC_DESK_EVENT_SNAPSHOT,
  TRAFFIC_DESK_OPTIONS
} from "./constants";
import { ResolvedTrafficDeskModuleOptions } from "./types/traffic-desk-options";
import { TrafficLogEntry } from "./types/traffic-log-entry";

/**
 * Manages the Socket.IO server that pushes live traffic events to the dashboard.
 *
 * Deliberately avoids @WebSocketGateway() and Nest's IoAdapter infrastructure so
 * consumers never need to call useWebSocketAdapter() or install
 * @nestjs/platform-socket.io. The Socket.IO server is attached directly to the
 * underlying Node.js HTTP server, which is available through HttpAdapterHost.
 */
@Injectable()
export class TrafficDeskGateway {
  private readonly logger = new Logger(TrafficDeskGateway.name);
  private server?: Server;
  private snapshotProvider?: () => TrafficLogEntry[];

  constructor(
    @Inject(TRAFFIC_DESK_OPTIONS)
    private readonly options: ResolvedTrafficDeskModuleOptions
  ) {}

  setSnapshotProvider(provider: () => TrafficLogEntry[]): void {
    this.snapshotProvider = provider;
  }

  /**
   * Creates a Socket.IO server on the raw Node.js HTTP server.
   * Called by TrafficHttpBinding once the HTTP adapter is resolved.
   */
  attachToHttpServer(httpServer: unknown): void {
    if (!this.options.enableWebsocket) {
      return;
    }

    const namespace = this.options.websocketNamespace || "/";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.server = new Server(httpServer as any, {
      cors: { origin: true, credentials: false }
    });

    this.server.of(namespace).on("connection", (client: Socket) => {
      if (this.snapshotProvider) {
        client.emit(TRAFFIC_DESK_EVENT_SNAPSHOT, this.snapshotProvider());
      }
    });

    this.logger.log(`Traffic desk WebSocket server attached (namespace: ${namespace})`);
  }

  broadcastNewEntry(entry: TrafficLogEntry): void {
    if (!this.options.enableWebsocket || !this.server) {
      return;
    }

    const namespace = this.options.websocketNamespace || "/";
    this.server.of(namespace).emit(TRAFFIC_DESK_EVENT_NEW, entry);
  }
}
