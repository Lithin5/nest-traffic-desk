import { Inject, Injectable } from "@nestjs/common";
import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import {
  TRAFFIC_DESK_EVENT_NEW,
  TRAFFIC_DESK_EVENT_SNAPSHOT,
  TRAFFIC_DESK_OPTIONS
} from "./constants";
import { TrafficDeskModuleOptions } from "./types/traffic-desk-options";
import { TrafficLogEntry } from "./types/traffic-log-entry";

@Injectable()
@WebSocketGateway({
  cors: { origin: true, credentials: false }
})
export class TrafficDeskGateway implements OnGatewayConnection {
  @WebSocketServer()
  server?: Server;

  private snapshotProvider?: () => TrafficLogEntry[];

  constructor(
    @Inject(TRAFFIC_DESK_OPTIONS)
    private readonly options: Required<TrafficDeskModuleOptions>
  ) {}

  setSnapshotProvider(provider: () => TrafficLogEntry[]): void {
    this.snapshotProvider = provider;
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
