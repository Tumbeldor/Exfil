import type { HostMsg, RaidClientMsg } from '../../shared/net/protocol';
import { RaidHost } from '../../shared/net/RaidHost';
import type { PlayerJoin, WorldConfig } from '../../shared/sim/World';
import type { NetClient } from './NetClient';

/** Verbindung einer Raid-Sitzung zu ihrem Host (lokal oder über das Netzwerk). */
export interface RaidLink {
  readonly coop: boolean;
  onMessage: ((m: HostMsg) => void) | null;
  send(m: RaidClientMsg): void;
  /** Pro Frame aufrufen (treibt den lokalen Host) */
  update(dt: number): void;
  paused: boolean;
  onLost?: (() => void) | null;
  close(): void;
}

/** Solo: Simulation läuft im Browser. */
export class LocalLink implements RaidLink {
  readonly coop = false;
  onMessage: ((m: HostMsg) => void) | null = null;
  paused = false;
  private host: RaidHost;
  private queue: HostMsg[] = [];

  constructor(cfg: WorldConfig, join: PlayerJoin) {
    this.host = new RaidHost(cfg, { snapshotEvery: 1, coop: false });
    this.host.join('local', (m) => this.queue.push(m.type === 'snap' || m.type === 'ev' ? m : structuredClone(m)), join);
    this.host.startAll();
  }

  get world() {
    return this.host.world;
  }

  send(m: RaidClientMsg) {
    this.host.handle('local', structuredClone(m));
  }

  update(dt: number) {
    if (!this.paused) this.host.update(dt);
    this.flush();
  }

  flush() {
    if (!this.onMessage) return;
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.onMessage(m);
  }

  close() {
    this.onMessage = null;
  }
}

/** Coop: Nachrichten über den WebSocket-Server. */
export class NetLink implements RaidLink {
  readonly coop = true;
  onMessage: ((m: HostMsg) => void) | null = null;
  paused = false;
  private off: () => void;
  private queue: HostMsg[] = [];

  /** Wird aufgerufen, wenn der Server keinen laufenden Raid mehr für uns hat. */
  onLost: (() => void) | null = null;
  private offLobby: () => void;
  private gotResult = false;

  constructor(private net: NetClient) {
    this.off = net.onRaid((m) => {
      if (m.type === 'result') this.gotResult = true;
      this.queue.push(m);
    });
    this.offLobby = net.onLobby((l) => {
      if (this.gotResult) return;
      const me = l?.players.find((p) => p.id === net.id);
      if (!l || !l.raidActive || (me && !me.inRaid)) setTimeout(() => !this.gotResult && this.onLost?.(), 1500);
    });
    this.offState = net.onState((st) => {
      if (st === 'failed' && !this.gotResult) this.onLost?.();
    });
  }
  private offState: () => void;

  /** Nachrichten, die vor dem Erstellen der Sitzung eintrafen. */
  prime(msgs: HostMsg[]) {
    this.queue.unshift(...msgs);
  }

  send(m: RaidClientMsg) {
    this.net.send(m);
  }

  update() {
    if (!this.onMessage) return;
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.onMessage(m);
  }

  close() {
    this.off();
    this.offLobby();
    this.offState();
    this.onMessage = null;
    this.onLost = null;
  }
}
