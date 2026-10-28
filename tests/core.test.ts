import { describe, expect, it } from 'vitest';
import { TILE } from '../src/shared/constants';
import { addToList, bagCapacity, emptyInventory, equipFromList, fitAmount, slotsUsed, starterInventory, takeFromList } from '../src/shared/inventory';
import { createItem, stackSlots } from '../src/shared/items';
import { rollContainer, botLoadout } from '../src/shared/loot';
import { buildMap, MAP_METAS } from '../src/shared/map/maps';
import { Navigator } from '../src/shared/map/nav';
import { F_SIGHT } from '../src/shared/map/tiles';
import { Rng } from '../src/shared/rng';

describe('Inventar', () => {
  it('stapelt Munition und respektiert Kapazität', () => {
    const list = [createItem('a9_fmj', 50)];
    expect(slotsUsed(list)).toBe(1);
    // 1 Einheit frei -> 10 passen in den bestehenden Stapel, 60 weitere in die neue Einheit
    expect(fitAmount(list, 2, createItem('a9_fmj', 200))).toBe(70);
    const left = addToList(list, 2, createItem('a9_fmj', 200));
    expect(left).toBe(130);
    expect(list[0].n).toBe(120);
    expect(stackSlots(list[0])).toBe(2);
  });

  it('lehnt Gegenstände ohne Platz ab', () => {
    const list = [createItem('battery')];
    expect(addToList(list, 4, createItem('fuel'))).toBe(1);
    expect(list.length).toBe(1);
  });

  it('teilt Stapel beim Entnehmen', () => {
    const list = [createItem('bandage', 4)];
    const part = takeFromList(list, list[0].uid, 1);
    expect(part?.n).toBe(1);
    expect(list[0].n).toBe(3);
    expect(part?.uid).not.toBe(list[0].uid);
  });

  it('tauscht Ausrüstung und prüft Rucksackgröße', () => {
    const inv = starterInventory(2);
    const before = bagCapacity(inv);
    inv.bag.push(createItem('bp_tac'));
    const r = equipFromList(inv, inv.bag[inv.bag.length - 1].uid);
    expect(r.ok).toBe(true);
    expect(inv.equip.backpack?.id).toBe('bp_tac');
    expect(bagCapacity(inv)).toBeGreaterThan(before);
    expect(inv.bag.some((x) => x.id === 'bp_sling')).toBe(true);
  });
});

describe('Beute', () => {
  it('erzeugt Inhalte für alle Behältertypen', () => {
    const rng = new Rng(42);
    for (const k of ['crate', 'weaponbox', 'ammobox', 'medcase', 'toolbox', 'filing', 'safe', 'pc', 'shelf', 'register'] as const) {
      let total = 0;
      for (let i = 0; i < 20; i++) total += rollContainer(k, 2, rng).length;
      expect(total, k).toBeGreaterThan(0);
    }
  });

  it('rüstet Bots aus', () => {
    const rng = new Rng(7);
    for (const t of ['scav', 'pmc', 'guard', 'boss'] as const) {
      const inv = botLoadout(t, rng, 'm249');
      expect(inv.equip.primary || inv.equip.secondary, t).toBeTruthy();
    }
  });
});

describe('Karten', () => {
  for (const meta of MAP_METAS) {
    it(`${meta.name}: ohne Warnungen und vollständig erreichbar`, () => {
      const m = buildMap(meta.id);
      expect((m as unknown as { warnings: string[] }).warnings).toEqual([]);
      expect(m.extracts.length).toBeGreaterThanOrEqual(5);
      expect(m.containers.length).toBeGreaterThan(100);
      expect(m.playerSpawns.length).toBeGreaterThanOrEqual(4);
      const nav = new Navigator(m);
      const s = m.playerSpawns[0];
      for (const e of m.extracts) {
        const p = nav.findPath(s.x, s.y, e.x, e.y, 60000);
        expect(p, e.id).not.toBeNull();
        const last = p![p!.length - 1];
        expect(Math.hypot(last.x - e.x, last.y - e.y), e.id).toBeLessThan(TILE * 2);
      }
    });
  }

  it('ist deterministisch', () => {
    const a = buildMap('grenzstadt');
    const b = buildMap('grenzstadt');
    expect(Buffer.from(a.tiles).equals(Buffer.from(b.tiles))).toBe(true);
    a.set(10, 10, 0);
    expect(b.get(10, 10)).not.toBe(-1);
  });

  it('Raycast stoppt an Wänden', () => {
    const m = buildMap('grenzstadt');
    // Rand ist Wand
    const d = m.raycast(5 * TILE, 50 * TILE, -1, 0, 2000, F_SIGHT);
    expect(d).toBeLessThan(5 * TILE);
  });

  it('Kollision verhindert das Durchlaufen von Wänden', () => {
    const m = buildMap('grenzstadt');
    const p = m.moveCircle(3.5 * TILE, 57.5 * TILE, -500, 0, 11);
    expect(p.x).toBeGreaterThanOrEqual(2 * TILE + 10);
  });
});

describe('Inventar leer', () => {
  it('emptyInventory hat Basis-Kapazität', () => {
    expect(bagCapacity(emptyInventory())).toBe(8);
  });
});
