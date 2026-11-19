import { ensureAccessToken, refreshSession } from "./api";
import type { ServerEvent } from "./types";

const HEARTBEAT_MS = 25_000;

/** WebSocket client with auto-reconnect (exponential backoff + jitter) and a heartbeat. */
export class SocketClient {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private reconnectTimer: number | undefined;
  private heartbeatTimer: number | undefined;
  private stopped = true;
  private everOpened = false;

  constructor(
    private onEvent: (e: ServerEvent) => void,
    private onStatus: (open: boolean, reconnected: boolean) => void,
  ) {}

  start() {
    this.stopped = false;
    void this.open();
  }

  stop() {
    this.stopped = true;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.heartbeatTimer);
    this.ws?.close();
    this.ws = null;
    this.everOpened = false;
    this.attempts = 0;
  }

  send(payload: object): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  private async open() {
    if (this.stopped || this.ws) return;
    let token: string | null = null;
    try {
      token = await ensureAccessToken();
    } catch {
      /* offline: retry below */
    }
    if (this.stopped || this.ws) return;
    if (!token) return this.scheduleReconnect();

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;

    ws.onopen = () => {
      const reconnected = this.everOpened;
      this.everOpened = true;
      this.attempts = 0;
      this.onStatus(true, reconnected);
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = window.setInterval(() => this.send({ type: "ping" }), HEARTBEAT_MS);
    };
    ws.onmessage = (ev) => {
      try {
        this.onEvent(JSON.parse(ev.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = (ev) => {
      window.clearInterval(this.heartbeatTimer);
      if (this.ws === ws) this.ws = null;
      this.onStatus(false, false);
      if (this.stopped) return;
      if (ev.code === 4401) {
        // Access token rejected: get a fresh one, then reconnect right away.
        refreshSession().then((ok) => ok && this.scheduleReconnect(0)).catch(() => this.scheduleReconnect());
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(delay?: number) {
    const wait = delay ?? Math.min(30_000, 1000 * 2 ** this.attempts) + Math.random() * 500;
    this.attempts += 1;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => void this.open(), wait);
  }
}
