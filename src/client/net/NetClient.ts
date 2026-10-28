import { PROTOCOL_VERSION } from '../../shared/constants';
import type { ClientMsg, HostMsg, LobbyState, ServerMsg } from '../../shared/net/protocol';

type Listener<T> = (m: T) => void;

const TOKEN_KEY = 'xl.net.token';

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

/** WebSocket-Client für Lobby und Coop-Raids mit automatischem Wiederverbinden. */
export class NetClient {
  private ws: WebSocket | null = null;
  state: 'idle' | 'connecting' | 'open' | 'closed' = 'idle';
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

  constructor(public url: string) {}

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
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.setState('closed');
      onFail?.(e as Error);
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.retry = 0;
      this.setState('open');
      let token: string | undefined;
      try {
        token = localStorage.getItem(TOKEN_KEY) ?? undefined;
      } catch {
        token = undefined;
      }
      this.send({ type: 'hello', v: PROTOCOL_VERSION, token, name: this.name });
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping', t: performance.now() }), 2000);
      onOpen?.();
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      this.dispatch(m);
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.ws = null;
      this.setState('closed');
      if (!opened) onFail?.(new Error('Server nicht erreichbar'));
      if (this.wantOpen && opened) {
        // Wiederverbinden mit Backoff
        const delay = Math.min(8000, 500 * Math.pow(2, this.retry++));
        setTimeout(() => {
          if (this.wantOpen) this.open();
        }, delay);
      }
    };
    ws.onerror = () => {
      /* onclose folgt */
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
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
    this.ws?.close();
    this.ws = null;
    this.lobby = null;
  }
}
