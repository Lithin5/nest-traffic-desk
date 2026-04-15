import { Inject, Injectable } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayInit
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import {
  TRAFFIC_DESK_EVENT_NEW,
  TRAFFIC_DESK_EVENT_SNAPSHOT,
  TRAFFIC_DESK_OPTIONS
} from "./constants";
import { ResolvedTrafficDeskModuleOptions } from "./types/traffic-desk-options";
import { TrafficLogEntry } from "./types/traffic-log-entry";

@Injectable()
@WebSocketGateway({
  cors: { origin: true, credentials: false }
})
export class TrafficDeskGateway implements OnGatewayConnection, OnGatewayInit {
  @WebSocketServer()
  server?: Server;

  private snapshotProvider?: () => TrafficLogEntry[];

  constructor(
    @Inject(TRAFFIC_DESK_OPTIONS)
    private readonly options: ResolvedTrafficDeskModuleOptions
  ) {}

  setSnapshotProvider(provider: () => TrafficLogEntry[]): void {
    this.snapshotProvider = provider;
  }

  afterInit(server: Server): void {
    const namespace = this.options.websocketNamespace;
    if (namespace === "/") {
      return;
    }

    server.of(namespace).on("connection", (client: Socket) => {
      if (!this.options.enableWebsocket) {
        client.disconnect(true);
        return;
      }

      if (this.snapshotProvider) {
        client.emit(TRAFFIC_DESK_EVENT_SNAPSHOT, this.snapshotProvider());
      }
    });
  }

  handleConnection(client: Socket): void {
    if (!this.options.enableWebsocket) {
      client.disconnect(true);
      return;
    }

    if (this.snapshotProvider) {
      client.emit(TRAFFIC_DESK_EVENT_SNAPSHOT, this.snapshotProvider());
    }
  }

  broadcastNewEntry(entry: TrafficLogEntry): void {
    if (!this.options.enableWebsocket || !this.server) {
      return;
    }

    const namespace = this.options.websocketNamespace;
    if (namespace === "/") {
      this.server.emit(TRAFFIC_DESK_EVENT_NEW, entry);
      return;
    }

    const nsp = this.server.of(namespace);
    nsp.emit(TRAFFIC_DESK_EVENT_NEW, entry);
  }
}
