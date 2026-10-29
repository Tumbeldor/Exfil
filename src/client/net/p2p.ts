import type { DataConnection, Peer as PeerType, PeerOptions } from 'peerjs';
import { LobbyServer, type Ticker, randomLobbyCode } from '../../shared/net/LobbyServer';
import { type Socket, type SocketFactory, loopbackSocket } from './sockets';

/**
 * Peer-to-Peer-Coop über WebRTC (PeerJS): Der Host betreibt Lobby und Raid in seinem Browser,
 * Gäste verbinden sich über den Lobby-Code. Kein eigener Server nötig – ideal für GitHub Pages.
 */

const PREFIX = 'exfil-game-v1-';
type PeerCtor = new (id?: string, opts?: PeerOptions) => PeerType;

let PeerClass: PeerCtor | null = null;
async function loadPeer(): Promise<PeerCtor> {
  if (!PeerClass) {
    const mod = await import('peerjs');
    PeerClass = (mod.Peer ?? (mod as unknown as { default: PeerCtor }).default) as PeerCtor;
  }
  return PeerClass;
}

/** Optional eigener Signalisierungsserver per URL-Parameter (?peerserver=host:port), sonst PeerJS-Cloud. */
function peerOptions(): PeerOptions {
  const q = new URLSearchParams(location.search).get('peerserver');
  if (!q) return { debug: 0 };
  const [host, port] = q.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: location.protocol === 'https:' && host !== 'localhost', debug: 0 };
}

function openPeer(Peer: PeerCtor, id?: string): Promise<PeerType> {
  return new Promise((resolve, reject) => {
    const p = new Peer(id, peerOptions());
    const timer = setTimeout(() => {
      p.destroy();
      reject(Object.assign(new Error('Signalisierungsserver nicht erreichbar'), { type: 'timeout' }));
    }, 15000);
    const onErr = (e: Error & { type?: string }) => {
      clearTimeout(timer);
      p.destroy();
      reject(e);
    };
    p.once('error', onErr);
    p.once('open', () => {
      clearTimeout(timer);
      p.off('error', onErr);
      p.on('error', (e) => console.warn('PeerJS', e));
      resolve(p);
    });
  });
}

/** Raid-Takt über einen Worker: läuft auch weiter, wenn der Host-Tab im Hintergrund ist (Desktop). */
export const workerTicker: Ticker = (fn, ms) => {
  try {
    const src = `let t=setInterval(()=>postMessage(0),${ms});onmessage=()=>{clearInterval(t);close()}`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = () => fn();
    return () => {
      w.postMessage(0);
      w.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }
};

export class P2PHost {
  readonly server: LobbyServer;
  private conns = new Set<DataConnection>();

  private constructor(
    private peer: PeerType,
    readonly code: string,
  ) {
    this.server = new LobbyServer({ ticker: workerTicker, singleLobby: true });
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.conns.add(conn);
        let closed = false;
        const h = this.server.attach({
          send: (d) => {
            if (conn.open) void conn.send(d);
          },
          close: () => conn.close(),
          isOpen: () => conn.open,
        });
        const done = () => {
          if (closed) return;
          closed = true;
          this.conns.delete(conn);
          h.close();
        };
        conn.on('data', (d) => h.message(String(d)));
        conn.on('close', done);
        conn.on('error', done);
      });
    });
    // Verbindung zum Signalisierungsserver verloren: bestehende Datenkanäle laufen weiter, neu anmelden für weitere Gäste
    peer.on('disconnected', () => {
      if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
  }

  static async create(): Promise<P2PHost> {
    const Peer = await loadPeer();
    let lastErr: unknown;
    for (let i = 0; i < 5; i++) {
      const code = randomLobbyCode();
      try {
        const peer = await openPeer(Peer, PREFIX + code);
        return new P2PHost(peer, code);
      } catch (e) {
        lastErr = e;
        if ((e as { type?: string }).type !== 'unavailable-id') break;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Lobby konnte nicht erstellt werden');
  }

  /** Socket für den eigenen Client des Hosts. */
  localSocket(): Socket {
    return loopbackSocket(this.server);
  }

  get guests() {
    return this.conns.size;
  }

  destroy() {
    this.server.shutdown();
    for (const c of this.conns) c.close();
    this.conns.clear();
    this.peer.destroy();
  }
}

let guestPeer: PeerType | null = null;
let guestPeerPromise: Promise<PeerType> | null = null;

async function getGuestPeer(): Promise<PeerType> {
  if (guestPeer && !guestPeer.destroyed && !guestPeer.disconnected) return guestPeer;
  if (guestPeerPromise) return guestPeerPromise;
  guestPeerPromise = (async () => {
    try {
      if (guestPeer && !guestPeer.destroyed) guestPeer.destroy();
      guestPeer = await openPeer(await loadPeer());
      return guestPeer;
    } finally {
      guestPeerPromise = null;
    }
  })();
  return guestPeerPromise;
}

/** Socket-Fabrik für Gäste: verbindet sich per WebRTC mit dem Host der Lobby. */
export function guestSocketFactory(code: string): SocketFactory {
  const target = PREFIX + code.toUpperCase();
  return () => {
    let open = false;
    let finished = false;
    let conn: DataConnection | null = null;
    const s: Socket = {
      onopen: null,
      onmessage: null,
      onclose: null,
      get isOpen() {
        return open;
      },
      send: (d) => {
        if (open && conn) void conn.send(d);
      },
      close: () => {
        conn?.close();
        finish();
      },
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      open = false;
      s.onclose?.();
    };
    getGuestPeer()
      .then((peer) => {
        if (finished) return;
        const timer = setTimeout(() => {
          if (!open) {
            conn?.close();
            finish();
          }
        }, 15000);
        const onPeerErr = (e: Error & { type?: string }) => {
          if (e.type === 'peer-unavailable' && String(e.message).includes(target)) {
            clearTimeout(timer);
            finish();
          }
        };
        peer.on('error', onPeerErr);
        conn = peer.connect(target, { reliable: true, serialization: 'raw' });
        conn.on('open', () => {
          clearTimeout(timer);
          peer.off('error', onPeerErr);
          open = true;
          s.onopen?.();
        });
        conn.on('data', (d) => s.onmessage?.(String(d)));
        conn.on('close', () => {
          peer.off('error', onPeerErr);
          finish();
        });
        conn.on('error', () => finish());
      })
      .catch(() => finish());
    return s;
  };
}

export function disposeGuestPeer() {
  guestPeer?.destroy();
  guestPeer = null;
}
