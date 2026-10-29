import { PROTOCOL_VERSION } from '../../shared/constants';
import type { ClientMsg, HostMsg, LobbyState, ServerMsg } from '../../shared/net/protocol';
import { type Socket, type SocketFactory } from './sockets';

type Listener<T> = (m: T) => void;

const TOKEN_KEY = 'exfil.net.token';

export function defaultServerUrl(custom: string): string {
  if (custom.trim()) {
    let u = custom.trim();
    if (u.startsWith('http')) u = u.replace(/^http/, 'ws');
    if (!/^wss?:\/\//.test(u)) u = (location.protocol === 'https:' ? 'wss://' : 'ws://') + u;
    if (!u.endsWith('/ws')) u = u.replace(/\/$/, '') + '/ws';
    return u;
  }
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}

/** Wiederverbindungsversuche: Server großzügig, P2P-Gäste merken einen weggefallenen Host schneller. */
const MAX_RETRIES = { server: 7, 'p2p-host': 2, 'p2p-guest': 3 } as const;

/** Client für Lobby und Coop-Raids (WebSocket oder WebRTC) mit automatischem Wiederverbinden. */
export class NetClient {
  private ws: Socket | null = null;
  /** failed = Wiederverbinden endgültig aufgegeben */
  state: 'idle' | 'connecting' | 'open' | 'closed' | 'failed' = 'idle';
  id = '';
  lobby: LobbyState | null = null;
  rtt = 0;
  private lobbyL = new Set<Listener<LobbyState | null>>();
  private raidL = new Set<Listener<HostMsg>>();
  private errorL = new Set<Listener<string>>();
  private stateL = new Set<Listener<string>>();
  private chatL = new Set<Listener<{ from: string; text: string }>>();
  private wantOpen = false;
  private retry = 0;
  private pingTimer: number | null = null;
  private name = 'Operator';
  private everOpened = false;

  constructor(
    /** Eindeutiger Schlüssel der Verbindung (z. B. Server-URL oder P2P-Code) */
    public readonly key: string,
    private factory: SocketFactory,
    public readonly kind: 'server' | 'p2p-host' | 'p2p-guest' = 'server',
  ) {}

  connect(name: string): Promise<void> {
    this.name = name;
    this.wantOpen = true;
    return new Promise((resolve, reject) => {
      let settled = false;
      this.open(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, (e) => {
        if (!settled) {
          settled = true;
          reject(e);
        }
      });
    });
  }

  private open(onOpen?: () => void, onFail?: (e: Error) => void) {
    this.setState('connecting');
    let ws: Socket;
    try {
      ws = this.factory();
    } catch (e) {
      this.setState('closed');
      onFail?.(e as Error);
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      if (this.ws !== ws || opened) return;
      opened = true;
      this.everOpened = true;
      this.retry = 0;
      this.setState('open');
      let token: string | undefined;
      try {
        token = localStorage.getItem(TOKEN_KEY) ?? undefined;
      } catch {
        token = undefined;
      }
      this.send({ type: 'hello', v: PROTOCOL_VERSION, token, name: this.name });
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping', t: performance.now() }), 2000);
      onOpen?.();
    };
    ws.onmessage = (data) => {
      if (this.ws !== ws) return;
      let m: ServerMsg;
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      this.dispatch(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.ws = null;
      if (!opened && !this.everOpened) {
        this.setState('closed');
        onFail?.(new Error('Verbindung fehlgeschlagen'));
        return;
      }
      if (!this.wantOpen) {
        this.setState('closed');
        return;
      }
      if (this.retry >= MAX_RETRIES[this.kind]) {
        this.wantOpen = false;
        this.lobby = null;
        this.setState('failed');
        for (const l of this.lobbyL) l(null);
        return;
      }
      // Wiederverbinden mit Backoff
      this.setState('connecting');
      const delay = Math.min(6000, 500 * Math.pow(2, this.retry++));
      setTimeout(() => {
        if (this.wantOpen) this.open();
      }, delay);
    };
  }

  private setState(s: NetClient['state']) {
    this.state = s;
    for (const l of this.stateL) l(s);
  }

  private dispatch(m: ServerMsg) {
    switch (m.type) {
      case 'welcome':
        this.id = m.id;
        try {
          localStorage.setItem(TOKEN_KEY, m.token);
        } catch {
          /* */
        }
        break;
      case 'lobby':
        this.lobby = m.lobby;
        for (const l of this.lobbyL) l(m.lobby);
        break;
      case 'error':
        for (const l of this.errorL) l(m.text);
        break;
      case 'chat':
        for (const l of this.chatL) l(m);
        break;
      case 'pong':
        this.rtt = performance.now() - m.t;
        break;
      default:
        for (const l of this.raidL) l(m as HostMsg);
    }
  }

  send(m: ClientMsg) {
    if (this.ws && this.ws.isOpen) this.ws.send(JSON.stringify(m));
  }

  onLobby(fn: Listener<LobbyState | null>) {
    this.lobbyL.add(fn);
    return () => this.lobbyL.delete(fn);
  }
  onRaid(fn: Listener<HostMsg>) {
    this.raidL.add(fn);
    return () => {
      this.raidL.delete(fn);
    };
  }
  onError(fn: Listener<string>) {
    this.errorL.add(fn);
    return () => this.errorL.delete(fn);
  }
  onState(fn: Listener<string>) {
    this.stateL.add(fn);
    return () => this.stateL.delete(fn);
  }
  onChat(fn: Listener<{ from: string; text: string }>) {
    this.chatL.add(fn);
    return () => this.chatL.delete(fn);
  }

  close() {
    this.wantOpen = false;
    this.send({ type: 'leave' });
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const ws = this.ws;
    this.ws = null;
    // "leave" noch zustellen lassen
    setTimeout(() => ws?.close(), 50);
    this.lobby = null;
    this.setState('closed');
  }
}
