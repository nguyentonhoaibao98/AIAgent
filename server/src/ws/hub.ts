import type { WebSocket, WebSocketServer } from "ws";
import type { ServerWSMessage } from "@maestro-office/shared";

export class WsHub {
  private clients = new Set<WebSocket>();

  attach(wss: WebSocketServer, onConnect: (ws: WebSocket) => void) {
    wss.on("connection", (ws) => {
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));
      ws.on("error", () => this.clients.delete(ws));
      onConnect(ws);
    });
  }

  send(ws: WebSocket, msg: ServerWSMessage) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }

  broadcast(msg: ServerWSMessage) {
    const raw = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(raw);
      }
    }
  }
}
