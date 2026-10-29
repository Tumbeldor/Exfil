import type { LobbyServer } from '../../shared/net/LobbyServer';

/** Minimale Socket-Schnittstelle, über die der NetClient mit einer Lobby spricht. */
export interface Socket {
  send(data: string): void;
  close(): void;
  readonly isOpen: boolean;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
}

export type SocketFactory = () => Socket;

/** WebSocket zu einem Node-Server. */
export function wsSocket(url: string): Socket {
  const ws = new WebSocket(url);
  const s: Socket = {
    onopen: null,
    onmessage: null,
    onclose: null,
    get isOpen() {
      return ws.readyState === WebSocket.OPEN;
    },
    send: (d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(d);
    },
    close: () => ws.close(),
  };
  ws.onopen = () => s.onopen?.();
  ws.onmessage = (ev) => s.onmessage?.(String(ev.data));
  ws.onclose = () => s.onclose?.();
  ws.onerror = () => {
    /* onclose folgt */
  };
  return s;
}

/** Direkte Verbindung zu einer LobbyServer-Instanz im selben Browser (P2P-Host spielt selbst mit). */
export function loopbackSocket(server: LobbyServer): Socket {
  let open = false;
  let closed = false;
  const s: Socket = {
    onopen: null,
    onmessage: null,
    onclose: null,
    get isOpen() {
      return open;
    },
    send: (d) => {
      if (open) queueMicrotask(() => handle.message(d));
    },
    close: () => {
      if (closed) return;
      closed = true;
      open = false;
      queueMicrotask(() => {
        handle.close();
        s.onclose?.();
      });
    },
  };
  const handle = server.attach({
    send: (d) => queueMicrotask(() => open && s.onmessage?.(d)),
    close: () => s.close(),
    isOpen: () => open,
  });
  queueMicrotask(() => {
    if (closed) return;
    open = true;
    s.onopen?.();
  });
  return s;
}
