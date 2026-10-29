import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/shared/constants';
import { starterInventory } from '../src/shared/inventory';
import { LobbyServer, type Ticker } from '../src/shared/net/LobbyServer';
import type { ClientMsg, ServerMsg } from '../src/shared/net/protocol';

/** Manuell getakteter Zeitgeber für deterministische Tests */
function manualTicker() {
  let fn: (() => void) | null = null;
  const ticker: Ticker = (f) => {
    fn = f;
    return () => (fn = null);
  };
  return { ticker, tick: () => fn?.() };
}

function client(server: LobbyServer) {
  const inbox: ServerMsg[] = [];
  let open = true;
  const h = server.attach({ send: (d) => inbox.push(JSON.parse(d)), close: () => (open = false), isOpen: () => open });
  return { inbox, send: (m: ClientMsg) => h.message(JSON.stringify(m)), close: () => h.close(), last: <T extends ServerMsg['type']>(t: T) => [...inbox].reverse().find((m) => m.type === t) as Extract<ServerMsg, { type: T }> | undefined };
}

describe('LobbyServer (transportunabhängig, auch für P2P)', () => {
  it('Lobby mit Wunschcode, Beitritt, Bereit und Raidstart', async () => {
    const mt = manualTicker();
    const server = new LobbyServer({ ticker: mt.ticker, singleLobby: true });
    const a = client(server);
    const b = client(server);
    a.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'A' });
    b.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'B' });
    a.send({ type: 'create', name: 'A', code: 'AB12' });
    expect(a.last('lobby')?.lobby?.code).toBe('AB12');
    // im P2P-Modus nur eine Lobby
    b.send({ type: 'create', name: 'B' });
    expect(b.last('error')).toBeDefined();
    b.send({ type: 'join', code: 'ab12', name: 'B' });
    expect(a.last('lobby')?.lobby?.players.length).toBe(2);
    const kit = { name: 'A', level: 3, color: '#ff0000', regen: 0, inv: starterInventory(2), kitValue: 1000 };
    a.send({ type: 'ready', ready: true, kit });
    b.send({ type: 'ready', ready: true, kit: { ...kit, name: 'B' } });
    a.send({ type: 'start' });
    expect(a.inbox.some((m) => m.type === 'raidStart')).toBe(true);
    expect(b.inbox.some((m) => m.type === 'raidStart')).toBe(true);
    // die Raid-Schleife rechnet mit Echtzeit
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 40));
      mt.tick();
    }
    expect(b.inbox.some((m) => m.type === 'snap')).toBe(true);
    expect(a.last('lobby')?.lobby?.raidActive).toBe(true);
    server.shutdown();
  });

  it('Wiederverbinden per Token übernimmt den Lobbyplatz', () => {
    const server = new LobbyServer({ ticker: manualTicker().ticker });
    const a = client(server);
    a.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'A' });
    a.send({ type: 'create', name: 'A' });
    const token = a.last('welcome')!.token;
    const code = a.last('lobby')!.lobby!.code;
    a.close();
    const a2 = client(server);
    a2.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'A', token });
    expect(a2.last('welcome')?.resumed).toBe(true);
    expect(a2.last('lobby')?.lobby?.code).toBe(code);
    server.shutdown();
  });
});
