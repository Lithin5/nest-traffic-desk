# nest-traffic-desk

`nest-traffic-desk` is a NestJS module that captures HTTP traffic and ships a React dashboard with live updates.

## Features (Phase 1-4)

- Global interceptor for inbound HTTP requests.
- In-memory bounded store (ring-style behavior via max entry cap).
- REST data endpoint with filtering.
- WebSocket push for realtime rows.
- Hardened realtime UX:
  - snapshot on connect
  - reconnect/backoff status visible in UI
  - stable event contract (`traffic:snapshot`, `traffic:new`)
- Optional outgoing HTTP capture (global `fetch`) with `direction: "outgoing"` entries.
- Pluggable storage:
  - default in-memory ring buffer
  - file-backed JSONL store with rotation and restart persistence
  - custom store via `storeFactory`
- React SPA dashboard (served by Nest) with:
  - path search
  - method multi-select
  - status filter (`4xx`, `500`, etc.)
  - clear filters
  - split list/detail inspector
  - JSON detail cards with copy buttons
  - direction column (`incoming` / `outgoing`)

## Install

```bash
npm install nest-traffic-desk
```

## Usage

```ts
import { Module } from "@nestjs/common";
import { NestTrafficDeskModule } from "nest-traffic-desk";

@Module({
  imports: [
    NestTrafficDeskModule.register({
      maxEntries: 1000,
      uiBasePath: "/_logs",
      dataPath: "/_logs/data"
    })
  ]
})
export class AppModule {}
```

## Configuration

`NestTrafficDeskModule.register(options)`

- `enabled` (`true`): turn module on/off.
- `maxEntries` (`1000`): in-memory cap.
- `maxBodySizeBytes` (`16384`): body truncation threshold.
- `captureRequestBody` (`true`)
- `captureResponseBody` (`true`)
- `redactHeaders` (`authorization,cookie,set-cookie,x-api-key`)
- `enableOutgoingHttp` (`false`): patch global `fetch` and log outbound calls.
- `uiBasePath` (`/_logs`)
- `dataPath` (`/_logs/data`)
- `uiDistPath` (`""`): custom absolute path to built SPA assets.
- `enableUi` (`true`)
- `enableWebsocket` (`true`)
- `websocketNamespace` (`/`)
- `ignorePaths` (`/_logs,/_logs/data,/socket.io`)
- `storage` (default `{ type: "memory" }`):
  - memory mode: `{ type: "memory" }`
  - file mode: `{ type: "file", filePath, maxFileSizeBytes, maxFiles }`
- `storeFactory`: custom store provider (`() => TrafficLogStore`).

### File Storage Example

```ts
NestTrafficDeskModule.register({
  maxEntries: 5000,
  storage: {
    type: "file",
    filePath: "./var/traffic/traffic-desk.log.jsonl",
    maxFileSizeBytes: 5 * 1024 * 1024,
    maxFiles: 4
  }
})
```

### Outgoing HTTP Example

```ts
NestTrafficDeskModule.register({
  enableOutgoingHttp: true
})
```

When enabled, outbound `fetch` calls are logged into the same stream with `direction: "outgoing"`.

## REST API

Default: `GET /_logs/data`

Query params:

- `q`: substring match on request path
- `method`: comma-separated methods (`GET,POST`)
- `status`: exact (`500`) or class (`4xx`)
- `sort`: `asc` or `desc` (default `desc`)
- `limit`: max results

Response:

```json
{
  "total": 42,
  "filteredCount": 7,
  "items": []
}
```

## WebSocket Contract

- Event `traffic:snapshot`: emitted to newly connected clients.
- Event `traffic:new`: emitted per new logged request.

The dashboard uses reconnect with exponential backoff and shows connection status (`Connected`, `Reconnecting (attempt N)`, `Connection error`).

## Build UI Assets

The dashboard build output is expected in `assets/ui`.

```bash
npm run build:ui
```

Then run:

```bash
npm run build
```

## Security Notes

- Sensitive headers are redacted by default.
- Protect `/_logs` and `/_logs/data` with your own auth guards/network controls in production.
- Keep body capture enabled only where appropriate.
