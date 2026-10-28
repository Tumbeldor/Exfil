import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants';
import { EQUIP_SLOTS, type Inventory, emptyInventory } from '../shared/inventory';
import { type ItemStack, hasItemDef, itemDef, makeUid } from '../shared/items';
import { MAP_METAS } from '../shared/map/maps';
import type { ClientMsg, JoinPayload, LobbyState, ServerMsg } from '../shared/net/protocol';
import { RaidHost } from '../shared/net/RaidHost';

const MAX_PLAYERS = 4;
const RESUME_GRACE_MS = 3 * 60 * 1000;

interface Client {
  id: string;
  token: string;
  ws: WebSocket | null;
  name: string;
  lobby: Lobby | null;
  kit: JoinPayload | null;
  ready: boolean;
  goneAt: number;
}

interface Lobby {
  code: string;
  hostId: string;
  mapId: string;
  difficulty: number;
  friendlyFire: boolean;
  members: Client[];
  raid: RaidHost | null;
  timer: NodeJS.Timeout | null;
}

function sanitizeItem(it: ItemStack | undefined): ItemStack | undefined {
  if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !hasItemDef(it.id)) return undefined;
  const d = itemDef(it.id);
  const n = Math.max(1, Math.min(Math.floor(Number(it.n) || 1), d.stack * 99));
  const out: ItemStack = { uid: typeof it.uid === 'string' ? it.uid.slice(0, 64) : makeUid(), id: it.id, n };
  if (typeof it.dur === 'number' && Number.isFinite(it.dur)) out.dur = Math.max(0, it.dur);
  if (typeof it.ammo === 'string' && hasItemDef(it.ammo)) out.ammo = it.ammo;
  if (typeof it.mag === 'number' && Number.isFinite(it.mag)) out.mag = Math.max(0, Math.min(200, Math.floor(it.mag)));
  if (it.ins === true) out.ins = true;
  return out;
}

/** Bereinigt eine vom Client gesendete Ausrüstung. */
export function sanitizeInventory(raw: Inventory | undefined): Inventory {
  const inv = emptyInventory(2);
  if (!raw || typeof raw !== 'object') return inv;
  for (const s of EQUIP_SLOTS) {
    const it = sanitizeItem(raw.equip?.[s]);
    if (it) inv.equip[s] = it;
  }
  inv.bag = (Array.isArray(raw.bag) ? raw.bag : []).slice(0, 80).map(sanitizeItem).filter((x): x is ItemStack => !!x);
  inv.secure = (Array.isArray(raw.secure) ? raw.secure : []).slice(0, 20).map(sanitizeItem).filter((x): x is ItemStack => !!x);
  inv.secureCap = Math.max(0, Math.min(12, Math.floor(Number(raw.secureCap) || 2)));
  return inv;
}

export class LobbyServer {
  private clients = new Map<string, Client>();
  private byToken = new Map<string, Client>();
  private lobbies = new Map<string, Lobby>();
  private sockets = new WeakMap<WebSocket, Client>();

  constructor() {
    setInterval(() => this.sweep(), 15000).unref();
  }

  private send(c: Client, m: ServerMsg) {
    if (c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify(m));
  }

  attach(ws: WebSocket) {
    ws.on('message', (data) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      try {
        this.onMessage(ws, msg);
      } catch (e) {
        console.error('Fehler bei Nachricht', msg.type, e);
      }
    });
    ws.on('close', () => this.onClose(ws));
    ws.on('error', () => {});
  }

  private onMessage(ws: WebSocket, msg: ClientMsg) {
    if (msg.type === 'hello') return this.hello(ws, msg);
    const c = this.sockets.get(ws);
    if (!c) return;
    switch (msg.type) {
      case 'ping':
        this.send(c, { type: 'pong', t: msg.t });
        break;
      case 'create':
        c.name = cleanName(msg.name) || c.name;
        this.leaveLobby(c);
        this.createLobby(c);
        break;
      case 'join': {
        c.name = cleanName(msg.name) || c.name;
        const l = this.lobbies.get(String(msg.code ?? '').toUpperCase());
        if (!l) return this.send(c, { type: 'error', text: 'Lobby nicht gefunden.' });
        if (l === c.lobby) return this.broadcast(l);
        if (l.members.length >= MAX_PLAYERS) return this.send(c, { type: 'error', text: 'Lobby ist voll (max. 4).' });
        this.leaveLobby(c);
        l.members.push(c);
        c.lobby = l;
        c.ready = false;
        this.broadcast(l);
        break;
      }
      case 'leave':
        this.leaveLobby(c);
        this.send(c, { type: 'lobby', lobby: null });
        break;
      case 'ready': {
        const l = c.lobby;
        if (!l || l.raid) return;
        c.ready = !!msg.ready;
        if (msg.ready && msg.kit) {
          const k = msg.kit;
          c.kit = {
            name: cleanName(k.name) || c.name,
            level: Math.max(1, Math.min(40, Math.floor(Number(k.level) || 1))),
            color: typeof k.color === 'string' && /^#[0-9a-f]{6}$/i.test(k.color) ? k.color : '#7fb069',
            regen: Math.max(0, Math.min(1, Number(k.regen) || 0)),
            inv: sanitizeInventory(k.inv),
            kitValue: Math.max(0, Number(k.kitValue) || 0),
          };
          c.name = c.kit.name;
        }
        if (c.ready && !c.kit) c.ready = false;
        this.broadcast(l);
        break;
      }
      case 'settings': {
        const l = c.lobby;
        if (!l || l.hostId !== c.id || l.raid) return;
        if (msg.mapId && MAP_METAS.some((m) => m.id === msg.mapId)) l.mapId = msg.mapId;
        if (typeof msg.difficulty === 'number') l.difficulty = Math.max(0, Math.min(2, Math.floor(msg.difficulty)));
        if (typeof msg.friendlyFire === 'boolean') l.friendlyFire = msg.friendlyFire;
        this.broadcast(l);
        break;
      }
      case 'start':
        this.startRaid(c);
        break;
      case 'chat': {
        const l = c.lobby;
        if (!l) return;
        const text = String(msg.text ?? '').slice(0, 120);
        if (!text.trim()) return;
        for (const m of l.members) this.send(m, { type: 'chat', from: c.name, text });
        break;
      }
      case 'in':
      case 'act':
        c.lobby?.raid?.handle(c.id, msg);
        break;
    }
  }

  private hello(ws: WebSocket, msg: Extract<ClientMsg, { type: 'hello' }>) {
    if (msg.v !== PROTOCOL_VERSION) {
      ws.send(JSON.stringify({ type: 'error', text: 'Version passt nicht – bitte Seite neu laden.' } satisfies ServerMsg));
    }
    let c = msg.token ? this.byToken.get(msg.token) : undefined;
    let resumed = false;
    if (c) {
      if (c.ws && c.ws !== ws) {
        this.sockets.delete(c.ws);
        try {
          c.ws.close();
        } catch {
          /* */
        }
      }
      c.ws = ws;
      c.goneAt = 0;
      resumed = true;
    } else {
      const id = randomBytes(6).toString('hex');
      const token = randomBytes(18).toString('hex');
      c = { id, token, ws, name: cleanName(msg.name) || 'Operator', lobby: null, kit: null, ready: false, goneAt: 0 };
      this.clients.set(id, c);
      this.byToken.set(token, c);
    }
    this.sockets.set(ws, c);
    this.send(c, { type: 'welcome', id: c.id, token: c.token, resumed });
    if (c.lobby) {
      this.broadcast(c.lobby);
      const raid = c.lobby.raid;
      if (raid && raid.hasClient(c.id)) raid.reconnect(c.id, (m) => this.send(c!, m));
    } else this.send(c, { type: 'lobby', lobby: null });
  }

  private onClose(ws: WebSocket) {
    const c = this.sockets.get(ws);
    if (!c) return;
    this.sockets.delete(ws);
    if (c.ws === ws) c.ws = null;
    c.goneAt = Date.now();
    if (c.lobby) {
      c.lobby.raid?.disconnect(c.id);
      if (!c.lobby.raid) c.ready = false;
      this.broadcast(c.lobby);
    }
  }

  private sweep() {
    const now = Date.now();
    for (const c of this.clients.values()) {
      if (c.ws || !c.goneAt || now - c.goneAt < RESUME_GRACE_MS) continue;
      this.leaveLobby(c);
      this.clients.delete(c.id);
      this.byToken.delete(c.token);
    }
  }

  private createLobby(c: Client) {
    let code = '';
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do {
      code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
    } while (this.lobbies.has(code));
    const l: Lobby = { code, hostId: c.id, mapId: 'grenzstadt', difficulty: 1, friendlyFire: false, members: [c], raid: null, timer: null };
    this.lobbies.set(code, l);
    c.lobby = l;
    c.ready = false;
    this.broadcast(l);
  }

  private leaveLobby(c: Client) {
    const l = c.lobby;
    if (!l) return;
    if (l.raid && l.raid.hasClient(c.id)) l.raid.abandon(c.id);
    l.members = l.members.filter((m) => m !== c);
    c.lobby = null;
    c.ready = false;
    if (!l.members.length) {
      this.stopRaid(l);
      this.lobbies.delete(l.code);
      return;
    }
    if (l.hostId === c.id) l.hostId = l.members[0].id;
    this.broadcast(l);
  }

  private state(l: Lobby): LobbyState {
    return {
      code: l.code,
      hostId: l.hostId,
      mapId: l.mapId,
      difficulty: l.difficulty,
      friendlyFire: l.friendlyFire,
      raidActive: !!l.raid,
      players: l.members.map((m) => ({
        id: m.id,
        name: m.name,
        level: m.kit?.level ?? 1,
        ready: m.ready,
        kitValue: m.kit?.kitValue ?? 0,
        color: m.kit?.color ?? '#7fb069',
        inRaid: !!l.raid && l.raid.hasClient(m.id) && !l.raid.clientDone(m.id),
        connected: !!m.ws,
      })),
    };
  }

  private broadcast(l: Lobby) {
    const st = this.state(l);
    for (const m of l.members) this.send(m, { type: 'lobby', lobby: st });
  }

  private startRaid(c: Client) {
    const l = c.lobby;
    if (!l || l.hostId !== c.id) return;
    if (l.raid) return this.send(c, { type: 'error', text: 'Es läuft bereits ein Raid.' });
    const players = l.members.filter((m) => m.ws && m.ready && m.kit);
    if (players.length !== l.members.filter((m) => m.ws).length || !players.length) return this.send(c, { type: 'error', text: 'Noch nicht alle bereit.' });
    const raid = new RaidHost(
      { mapId: l.mapId, seed: Math.floor(Math.random() * 2 ** 31), difficulty: l.difficulty, players: players.length, friendlyFire: l.friendlyFire },
      { snapshotEvery: 2, coop: true },
    );
    for (const m of players) {
      const k = m.kit!;
      raid.join(m.id, (msg) => this.send(m, msg), { name: k.name, inv: k.inv, level: k.level, color: k.color, regen: k.regen });
      m.ready = false;
      m.kit = null;
    }
    l.raid = raid;
    raid.startAll();
    let last = performance.now();
    l.timer = setInterval(() => {
      const now = performance.now();
      raid.update((now - last) / 1000);
      last = now;
    }, 1000 / 30);
    raid.onEnd = () => {
      setTimeout(() => this.stopRaid(l), 500);
    };
    console.log(`[${l.code}] Raid gestartet auf ${l.mapId} mit ${players.length} Spieler(n)`);
    this.broadcast(l);
  }

  private stopRaid(l: Lobby) {
    if (l.timer) clearInterval(l.timer);
    l.timer = null;
    if (l.raid) console.log(`[${l.code}] Raid beendet`);
    l.raid = null;
    if (this.lobbies.has(l.code)) this.broadcast(l);
  }

  stats() {
    return { clients: this.clients.size, lobbies: this.lobbies.size, raids: [...this.lobbies.values()].filter((l) => l.raid).length };
  }
}

function cleanName(n: unknown): string {
  return String(n ?? '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 16);
}
