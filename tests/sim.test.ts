import { describe, expect, it } from 'vitest';
import { TICK_DT, TILE } from '../src/shared/constants';
import { countItem, starterInventory } from '../src/shared/inventory';
import { createItem } from '../src/shared/items';
import type { HostMsg } from '../src/shared/net/protocol';
import { RaidHost } from '../src/shared/net/RaidHost';
import { applyRaidResult, beginRaid, buyOffer, claimQuest, insureItem, newProfile, questStatus, sellItem } from '../src/shared/profile';
import { QUESTS } from '../src/shared/quests';
import { OFFERS } from '../src/shared/trader';
import type { Actor } from '../src/shared/sim/types';
import { World } from '../src/shared/sim/World';

function quietWorld(mapId = 'grenzstadt', seed = 3) {
  const w = new World({ mapId, seed, difficulty: 1, players: 1, friendlyFire: false });
  for (const a of [...w.actors.values()]) if (a.kind === 'bot') w.actors.delete(a.id);
  const p = w.addPlayer({ name: 'Test', inv: starterInventory(4), level: 1, color: '#fff', regen: 0 });
  return { w, p };
}

function run(w: World, seconds: number, each?: () => void) {
  for (let i = 0; i < seconds / TICK_DT; i++) {
    each?.();
    w.step(TICK_DT);
    w.events.length = 0;
  }
}

function teleport(w: World, p: Actor, x: number, y: number) {
  const n = w.map.nearestWalkable(Math.floor(x / TILE), Math.floor(y / TILE), 3)!;
  p.x = (n[0] + 0.5) * TILE;
  p.y = (n[1] + 0.5) * TILE;
}

describe('Simulation', () => {
  it('Behälter durchsuchen und Beute nehmen', () => {
    const { w, p } = quietWorld();
    const c = [...w.containers.values()].find((x) => x.kind === 'crate' && x.items.length > 0)!;
    teleport(w, p, c.x, c.y);
    w.doAction(p.id, { a: 'interact', kind: 'container', id: c.id });
    expect(p.action?.type).toBe('search');
    run(w, 4);
    expect(p.viewing).toBe(c.id);
    expect(p.stats!.searched.crate).toBe(1);
    const item = c.items[0];
    const before = p.inv.bag.length;
    w.doAction(p.id, { a: 'take', c: c.id, uid: item.uid, to: 'bag' });
    const has = p.inv.bag.some((x) => x.id === item.id) || Object.values(p.inv.equip).some((x) => x?.id === item.id);
    expect(has || p.inv.bag.length > before).toBe(true);
  });

  it('Extraktion an offenem Ausgang', () => {
    const { w, p } = quietWorld();
    const ex = w.map.extracts.find((e) => e.kind === 'open')!;
    p.x = ex.x;
    p.y = ex.y;
    run(w, 9);
    const r = w.results.get(p.id)!;
    expect(r.status).toBe('extracted');
    expect(r.xp.extract).toBe(600);
    expect(w.ended).toBe(true);
  });

  it('Bezahlte Extraktion verbraucht Bargeld', () => {
    const { w, p } = quietWorld();
    p.inv.bag.push(createItem('cash', 9000));
    const ex = w.map.extracts.find((e) => e.kind === 'paid')!;
    p.x = ex.x;
    p.y = ex.y;
    run(w, 9);
    const r = w.results.get(p.id)!;
    expect(r.status).toBe('extracted');
    expect(countItem(r.inventory, 'cash')).toBe(9000 - ex.cost!);
  });

  it('Tod: nur sicherer Behälter bleibt, Leiche enthält Ausrüstung', () => {
    const { w, p } = quietWorld();
    p.inv.secure.push(createItem('wallet'));
    w.damage(p, 999, null, 'frag', false);
    const r = w.results.get(p.id)!;
    expect(r.status).toBe('killed');
    expect(r.inventory.secure.map((x) => x.id)).toEqual(['wallet']);
    expect(r.inventory.equip.primary).toBeUndefined();
    const corpse = [...w.containers.values()].find((c) => c.kind === 'corpse')!;
    expect(corpse.items.some((x) => x.id === 'mp133')).toBe(true);
  });

  it('Nachladen verbraucht Munition aus der Tasche', () => {
    const { w, p } = quietWorld();
    const wpn = p.inv.equip.primary!;
    wpn.mag = 2;
    const before = countItem(p.inv, 'a12_buck');
    w.startReload(p);
    run(w, 3.5);
    expect(wpn.mag).toBe(6);
    expect(countItem(p.inv, 'a12_buck')).toBe(before - 4);
  });

  it('Spieler kann einen Plünderer erschießen', () => {
    const { w, p } = quietWorld();
    p.x = 40 * TILE;
    p.y = 57.5 * TILE;
    p.inv.equip.primary = createItem('m4a1', 1, { ammo: 'a556_fmj' });
    p.active = 'primary';
    p.inv.bag.push(createItem('a556_fmj', 120));
    const bot = w.spawnBot('scav', p.x + 160, p.y, 99, null);
    bot.brain!.reactT = 99;
    bot.brain!.skill.react = 99;
    let t = 0;
    run(w, 6, () => {
      t += TICK_DT;
      if (!bot.alive) return;
      const aim = Math.atan2(bot.y - p.y, bot.x - p.x);
      w.applyInput(p.id, { x: p.x, y: p.y, aim, sprint: false, ads: true, moving: false, shots: t % 0.1 < TICK_DT ? [[aim]] : undefined });
      if ((p.inv.equip.primary!.mag ?? 0) === 0 && p.ws.reloadT <= 0) w.startReload(p);
    });
    expect(bot.alive).toBe(false);
    expect(p.stats!.kills.scav).toBe(1);
    expect([...w.containers.values()].some((c) => c.kind === 'corpse' && c.owner === 'scav')).toBe(true);
  });

  it('Bots erkennen und bekämpfen den Spieler', () => {
    const { w, p } = quietWorld();
    p.x = 40 * TILE;
    p.y = 57.5 * TILE;
    const bot = w.spawnBot('pmc', p.x + 300, p.y, 98, null);
    bot.aim = Math.PI; // schaut zum Spieler
    let shots = 0;
    for (let i = 0; i < 20 / TICK_DT && p.alive && !w.results.has(p.id); i++) {
      w.applyInput(p.id, { x: p.x, y: p.y, aim: 0, sprint: false, ads: false, moving: false });
      w.step(TICK_DT);
      shots += w.events.filter((e) => e.e === 'shot' && e.id === bot.id).length;
      w.events.length = 0;
    }
    expect(shots).toBeGreaterThan(0);
    expect(p.hp < 100 || w.results.has(p.id)).toBe(true);
  });

  it('Heli muss gerufen werden und landet', () => {
    const { w, p } = quietWorld();
    const ex = w.map.extracts.find((e) => e.kind === 'heli')!;
    p.x = ex.x;
    p.y = ex.y;
    w.doAction(p.id, { a: 'interact', kind: 'radio', id: ex.id });
    run(w, 3, () => w.applyInput(p.id, { x: ex.x, y: ex.y, aim: 0, sprint: false, ads: false, moving: false }));
    const st = w.extracts.find((e) => e.def.id === ex.id)!;
    expect(st.heli!.phase).toBe('inbound');
    // Wellen-Bots entfernen, damit der Test deterministisch bleibt
    for (const a of [...w.actors.values()]) if (a.kind === 'bot') w.actors.delete(a.id);
    run(w, 52, () => w.applyInput(p.id, { x: ex.x, y: ex.y, aim: 0, sprint: false, ads: false, moving: false }));
    expect(w.results.get(p.id)?.status).toBe('extracted');
    expect(w.results.get(p.id)?.extractId).toBe('heli');
  });

  it('Ungültige Bewegung wird korrigiert', () => {
    const { w, p } = quietWorld();
    const corr = w.applyInput(p.id, { x: p.x + 2000, y: p.y, aim: 0, sprint: false, ads: false, moving: true });
    expect(corr).toBeDefined();
  });
});

describe('Coop', () => {
  it('Spieler geht zu Boden und wird wiederbelebt', () => {
    const w = new World({ mapId: 'grenzstadt', seed: 11, difficulty: 1, players: 2, friendlyFire: false });
    for (const a of [...w.actors.values()]) if (a.kind === 'bot') w.actors.delete(a.id);
    const a = w.addPlayer({ name: 'A', inv: starterInventory(2), level: 1, color: '#fff', regen: 0 });
    const b = w.addPlayer({ name: 'B', inv: starterInventory(2), level: 1, color: '#f00', regen: 0 });
    b.x = a.x + 30;
    b.y = a.y;
    w.damage(a, 150, null, 'frag', false);
    expect(a.alive).toBe(true);
    expect(a.downed).toBe(true);
    w.doAction(b.id, { a: 'interact', kind: 'revive', id: a.id });
    expect(b.action?.type).toBe('revive');
    run(w, 4.5);
    expect(a.downed).toBe(false);
    expect(a.hp).toBeGreaterThan(0);
  });

  it('Ohne Mitspieler und ohne Selbstwiederbelebung stirbt man sofort', () => {
    const { w, p } = quietWorld();
    w.damage(p, 150, null, 'frag', false);
    expect(w.results.get(p.id)?.status).toBe('killed');
  });

  it('Selbstwiederbelebung wird automatisch eingesetzt', () => {
    const { w, p } = quietWorld();
    p.inv.bag.push(createItem('selfrevive'));
    w.damage(p, 150, null, 'frag', false);
    expect(p.downed).toBe(true);
    run(w, 4.5);
    expect(p.downed).toBe(false);
    expect(countItem(p.inv, 'selfrevive')).toBe(0);
  });
});

describe('Plünderer-Einsatz', () => {
  it('Plünderer-Bots sind neutral, bis man auf sie schießt', () => {
    const w = new World({ mapId: 'grenzstadt', seed: 21, difficulty: 1, players: 1, friendlyFire: false });
    for (const a of [...w.actors.values()]) if (a.kind === 'bot') w.actors.delete(a.id);
    const p = w.addPlayer({ name: 'S', inv: starterInventory(0), level: 1, color: '#fff', regen: 0, scav: true });
    p.x = 40 * TILE;
    p.y = 57.5 * TILE;
    const bot = w.spawnBot('scav', p.x + 200, p.y, 7, null);
    bot.aim = Math.PI;
    const pmc = w.spawnBot('pmc', p.x - 2000, p.y, 8, null);
    expect(w.hostile(bot, p)).toBe(false);
    expect(w.hostile(pmc, p)).toBe(true);
    let shots = 0;
    run(w, 5, () => {
      w.applyInput(p.id, { x: p.x, y: p.y, aim: 0, sprint: false, ads: false, moving: false });
      shots += w.events.filter((e) => e.e === 'shot' && e.id === bot.id).length;
    });
    expect(bot.brain!.state).not.toBe('combat');
    expect(p.hp).toBe(100);
    w.damage(bot, 10, p, 'mp133', false);
    expect(p.scavAngry).toBe(true);
    expect(w.hostile(bot, p)).toBe(true);
    expect(bot.brain!.state).toBe('combat');
  });

  it('Beute eines Plünderer-Einsatzes landet im Lager, eigene Ausrüstung bleibt', () => {
    const p = newProfile('S');
    const before = p.char.equip.primary!.uid;
    const kit = beginRaid(p, 'grenzstadt', false, true);
    expect(kit.equip.primary || kit.equip.secondary).toBeTruthy();
    expect(p.scavReadyAt).toBeGreaterThan(Date.now());
    kit.bag.push(createItem('goldbar'));
    const vaultBefore = p.vault.length;
    const rep = applyRaidResult(p, {
      status: 'extracted', mapId: 'grenzstadt', extractId: 'west', inventory: kit, scav: true,
      stats: { kills: { scav: 0, pmc: 0, guard: 0, boss: 0 }, killLog: [], searched: {}, bodies: 0, visited: [], damage: 0, shots: 0, hits: 0, heliCalls: 0, revives: 0, startValue: 0 },
      time: 100, xp: { kills: 0, search: 0, extract: 600, survival: 40, total: 640 }, endValue: 90000,
    });
    expect(rep.scav).toBe(true);
    expect(p.char.equip.primary!.uid).toBe(before);
    expect(p.vault.length).toBeGreaterThan(vaultBefore);
    expect(p.vault.some((x) => x.id === 'goldbar')).toBe(true);
  });
});

describe('Versicherung', () => {
  it('versicherte Ausrüstung kehrt nach dem Tod ins Lager zurück', () => {
    const p = newProfile('V');
    p.char.equip.armor = createItem('vest_light');
    expect(insureItem(p, p.char.equip.armor.uid).ok).toBe(true);
    const kit = beginRaid(p, 'grenzstadt', false);
    const rep = applyRaidResult(p, {
      status: 'killed', mapId: 'grenzstadt', inventory: { equip: {}, bag: [], secure: [], secureCap: 2 },
      stats: { kills: { scav: 0, pmc: 0, guard: 0, boss: 0 }, killLog: [], searched: {}, bodies: 0, visited: [], damage: 0, shots: 0, hits: 0, heliCalls: 0, revives: 0, startValue: 30000 },
      time: 100, xp: { kills: 0, search: 0, extract: 0, survival: 0, total: 0 }, endValue: 0,
    });
    expect(kit.equip.armor?.ins).toBe(true);
    expect(rep.insured).toBe(1);
    const back = p.vault.find((x) => x.id === 'vest_light')!;
    expect(back.ins).toBe(false);
    expect(p.char.equip.armor).toBeUndefined();
  });
});

describe('RaidHost', () => {
  it('sendet Start, Inventar und Snapshots', () => {
    const host = new RaidHost({ mapId: 'hafen', seed: 5, difficulty: 1, players: 1, friendlyFire: false }, { snapshotEvery: 2, coop: true });
    const msgs: HostMsg[] = [];
    const id = host.join('a', (m) => msgs.push(m), { name: 'A', inv: starterInventory(2), level: 5, color: '#fff', regen: 0 });
    host.startAll();
    for (let i = 0; i < 6; i++) host.stepOnce();
    expect(msgs.some((m) => m.type === 'raidStart')).toBe(true);
    expect(msgs.some((m) => m.type === 'inv')).toBe(true);
    const snap = msgs.find((m) => m.type === 'snap');
    expect(snap && snap.type === 'snap' && snap.s.me?.alive).toBe(true);
    host.abandon('a');
    host.stepOnce();
    expect(host.world.results.get(id)?.status).toBe('killed');
    expect(host.ended).toBe(true);
  });
});

describe('RaidHost Wiederverbindung', () => {
  it('liefert ein während der Trennung entstandenes Ergebnis nach', () => {
    const host = new RaidHost({ mapId: 'grenzstadt', seed: 9, difficulty: 1, players: 2, friendlyFire: false }, { snapshotEvery: 2, coop: true });
    const a: HostMsg[] = [];
    const b: HostMsg[] = [];
    const ida = host.join('a', (m) => a.push(m), { name: 'A', inv: starterInventory(2), level: 1, color: '#fff', regen: 0 });
    host.join('b', (m) => b.push(m), { name: 'B', inv: starterInventory(2), level: 1, color: '#f00', regen: 0 });
    host.startAll();
    host.stepOnce();
    host.disconnect('a');
    const pa = host.world.actors.get(ida)!;
    host.world.kill(pa, null, 'frag', false);
    host.stepOnce();
    expect(a.some((m) => m.type === 'result')).toBe(false);
    expect(host.ended).toBe(false);
    const a2: HostMsg[] = [];
    host.reconnect('a', (m) => a2.push(m));
    expect(a2.some((m) => m.type === 'result' && m.r.status === 'killed')).toBe(true);
  });
});

describe('Progression', () => {
  it('wendet Raid-Ergebnis an und schaltet Aufträge frei', () => {
    const p = newProfile('X');
    const kit = beginRaid(p, 'grenzstadt', false);
    kit.bag.push(createItem('cash', 5000));
    const startMoney = p.money;
    const rep = applyRaidResult(p, {
      status: 'extracted',
      mapId: 'grenzstadt',
      extractId: 'west',
      inventory: kit,
      stats: { kills: { scav: 2, pmc: 0, guard: 0, boss: 0 }, killLog: [{ type: 'scav', wclass: 'shotgun', map: 'grenzstadt', head: false }, { type: 'scav', wclass: 'shotgun', map: 'grenzstadt', head: true }], searched: { crate: 3 }, bodies: 1, visited: [], damage: 100, shots: 10, hits: 5, heliCalls: 0, revives: 0, startValue: 1000 },
      time: 300,
      xp: { kills: 330, search: 100, extract: 600, survival: 125, total: 1155 },
      endValue: 20000,
    });
    expect(p.money).toBe(startMoney + 5000);
    expect(rep.levelAfter).toBe(2);
    expect(p.activeRaid).toBeNull();
    const intro = QUESTS.find((q) => q.id === 'q_intro')!;
    expect(questStatus(p, intro)).toBe('complete');
    expect(claimQuest(p, 'q_intro').ok).toBe(true);
    // Folgeauftrag freigeschaltet
    expect(p.quests.q_scav1).toBeDefined();
  });

  it('kaufen und verkaufen', () => {
    const p = newProfile('Y');
    const offer = OFFERS.find((o) => o.item === 'sks')!;
    const money = p.money;
    expect(buyOffer(p, offer).ok).toBe(true);
    expect(p.money).toBe(money - offer.price);
    const sks = p.vault.find((x) => x.id === 'sks')!;
    const r = sellItem(p, sks.uid);
    expect(r.ok).toBe(true);
    expect(p.money).toBeLessThan(money);
    const locked = OFFERS.find((o) => o.item === 'm249')!;
    expect(buyOffer(p, locked).ok).toBe(false);
  });
});
