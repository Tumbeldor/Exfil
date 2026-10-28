import { TILE } from '../constants';
import type { GameMap, MapMeta } from './GameMap';
import { MapBuilder } from './builder';
import { T } from './tiles';

const C = (t: number) => t * TILE + TILE / 2;
const P = (tx: number, ty: number) => ({ x: C(tx), y: C(ty) });

export const MAP_METAS: MapMeta[] = [
  {
    id: 'grenzstadt',
    name: 'Grenzstadt',
    desc: 'Verlassene Kleinstadt an der Grenze. Wohnviertel, Rathaus, Industriegebiet und eine Militärbasis im Nordosten, in der der Kommandant residiert.',
    raidTime: 28 * 60,
    minLevel: 1,
    scavGroups: 9,
    pmcGroups: 2,
    ambient: 'town',
  },
  {
    id: 'hafen',
    name: 'Industriehafen',
    desc: 'Containerlabyrinth, Lagerhallen und ein vor Anker liegender Frachter. Enge Gefechte, hohe Beute – und Kapitän Volkov.',
    raidTime: 32 * 60,
    minLevel: 5,
    scavGroups: 9,
    pmcGroups: 3,
    ambient: 'harbor',
  },
];

export function mapMeta(id: string): MapMeta {
  const m = MAP_METAS.find((x) => x.id === id);
  if (!m) throw new Error('Unbekannte Karte ' + id);
  return m;
}

const cache = new Map<string, GameMap>();

/** Erzeugt die Karte deterministisch (gleiches Layout auf Client & Server). Jede Raid-Instanz bekommt eine eigene Kopie. */
export function buildMap(id: string): GameMap {
  let base = cache.get(id);
  if (!base) {
    base = id === 'hafen' ? buildHafen() : buildGrenzstadt();
    cache.set(id, base);
  }
  return cloneMap(base);
}

function cloneMap(m: GameMap): GameMap {
  const Ctor = m.constructor as new (meta: MapMeta, w: number, h: number, tiles: Uint8Array) => GameMap;
  const c = new Ctor(m.meta, m.w, m.h, new Uint8Array(m.tiles));
  c.props = m.props;
  c.containers = m.containers;
  c.extracts = m.extracts;
  c.playerSpawns = m.playerSpawns;
  c.botSpawns = m.botSpawns;
  c.zones = m.zones;
  c.locks = m.locks;
  c.lootSpots = m.lootSpots;
  c.boss = m.boss;
  (c as GameMap & { warnings?: string[] }).warnings = (m as GameMap & { warnings?: string[] }).warnings;
  return c;
}

// ======================================================================
// Grenzstadt
// ======================================================================
function buildGrenzstadt(): GameMap {
  const W = 150;
  const H = 110;
  const b = new MapBuilder(mapMeta('grenzstadt'), W, H, 0x6e3a17);
  b.fill({ x: 0, y: 0, w: W, h: H }, T.GRASS);

  // Erdflecken für Abwechslung
  for (let i = 0; i < 40; i++) b.ellipse(b.rng.int(5, W - 5), b.rng.int(5, H - 5), b.rng.range(2, 6), b.rng.range(2, 5), T.DIRT, 0.15);

  // Bahnlinie im Norden
  b.fill({ x: 2, y: 3, w: W - 4, h: 3 }, T.RAIL);
  b.props.push({ type: 'rails', x: 2 * TILE, y: 4.5 * TILE, w: (W - 4) * TILE, h: 0 });
  b.reserve({ x: 2, y: 2, w: W - 4, h: 5 });

  // Straßen
  b.road({ x: 2, y: 56, w: W - 4, h: 4 }); // Hauptstraße O-W
  b.road({ x: 72, y: 19, w: 4, h: 89 }); // Hauptstraße N-S
  b.road({ x: 2, y: 88, w: 111, h: 3 }); // Südstraße
  b.road({ x: 30, y: 30, w: 3, h: 78 }); // Weststraße
  b.road({ x: 110, y: 46, w: 3, h: 62 }); // Oststraße
  b.road({ x: 30, y: 30, w: 68, h: 3 }); // Nordstraße zur Basis
  for (const r of [
    { x: 2, y: 55, w: W - 4, h: 6 },
    { x: 71, y: 19, w: 6, h: 89 },
    { x: 2, y: 87, w: 111, h: 5 },
    { x: 29, y: 30, w: 5, h: 78 },
    { x: 109, y: 46, w: 5, h: 62 },
    { x: 30, y: 29, w: 68, h: 5 },
  ])
    b.reserve(r);

  // Nordwest-Wald mit See
  b.ellipse(16, 22, 10, 6.5, T.SAND, 0.1);
  b.ellipse(16, 22, 8.5, 5.2, T.WATER, 0.08);
  b.reserve({ x: 5, y: 15, w: 23, h: 15 });
  b.addZone({ id: 'see', name: 'Waldsee', x: 4, y: 14, w: 25, h: 17, patrol: 0.6 });

  // Jägerhütte
  b.building({ id: 'huette', name: 'Jägerhütte', x: 18, y: 36, w: 9, h: 7, kind: 'cabin', doors: [{ side: 'e', at: 0.5 }], tier: 2, maxRoom: 9 });
  b.crates(14, 38, 1, 1, { container: 'crate', tier: 2 });

  // Bahnhof
  b.fill({ x: 56, y: 6, w: 32, h: 1 }, T.CONCRETE);
  b.building({
    id: 'bahnhof', name: 'Bahnhof', x: 60, y: 7, w: 24, h: 11, kind: 'station',
    doors: [{ side: 's', at: 12, width: 3 }, { side: 'n', at: 4, width: 2 }, { side: 'n', at: 17, width: 2 }], tier: 1,
  });
  b.solidProp('wagon', 18, 3, 9, 2, T.LOW, '#5d3b2a');
  b.solidProp('wagon', 95, 3, 9, 2, T.LOW, '#3b4d5d');
  b.solidProp('wagon', 106, 3, 9, 2, T.LOW, '#5d5a3b');
  b.placeContainer('crate', 99, 3, 2, false);

  // Militärbasis
  b.fill({ x: 98, y: 8, w: 48, h: 38 }, T.GRAVEL);
  b.fence({ x: 98, y: 8, w: 48, h: 38 }, [
    { side: 'w', at: 22, width: 3 },
    { side: 's', at: 12, width: 3 },
  ]);
  b.addZone({ id: 'basis', name: 'Militärbasis', x: 98, y: 8, w: 48, h: 38, tier: 3, patrol: 1.6 });
  b.building({ id: 'kaserne_a', name: 'Kaserne A', x: 101, y: 11, w: 17, h: 10, kind: 'barracks', doors: [{ side: 's', at: 0.3 }], tier: 2 });
  b.building({ id: 'kaserne_b', name: 'Kaserne B', x: 101, y: 34, w: 17, h: 9, kind: 'barracks', doors: [{ side: 'n', at: 0.6 }], tier: 2 });
  b.building({
    id: 'hq', name: 'Kommandozentrale', x: 124, y: 11, w: 19, h: 14, kind: 'hq',
    doors: [{ side: 's', at: 0.3 }, { side: 'w', at: 0.6 }], tier: 3, locked: { keyId: 'bunker', name: 'Kommandobunker', tier: 4 }, patrol: 1.5, windows: 0.15,
  });
  b.building({ id: 'fahrzeughalle', name: 'Fahrzeughalle', x: 124, y: 30, w: 18, h: 12, kind: 'garage', doors: [{ side: 'w', at: 0.4, width: 3 }], tier: 2, maxRoom: 12 });
  b.solidProp('truck', 120, 22, 2, 5, T.LOW, '#3e4a32');
  b.solidProp('truck', 103, 23, 5, 2, T.LOW, '#3e4a32');
  b.sandbags(112, 22, 4, true);
  b.sandbags(99, 28, 1, false);
  b.sandbags(104, 31, 4, true);
  b.sandbags(136, 27, 5, true);
  b.crates(113, 32, 2, 1, { container: 'ammobox', tier: 3, prop: 'milcrate' });
  b.crates(138, 43, 2, 1, { container: 'weaponbox', tier: 3, prop: 'milcrate' });
  b.crates(143, 26, 1, 2, { container: 'crate', tier: 2, prop: 'milcrate' });
  b.props.push({ type: 'helipad', x: C(110) - TILE / 2, y: C(27) - TILE / 2, w: TILE * 3, h: TILE * 3 });
  b.reserve({ x: 107, y: 25, w: 7, h: 6 });

  // Rathaus & Café
  b.building({
    id: 'rathaus', name: 'Rathaus', x: 44, y: 37, w: 22, h: 16, kind: 'office',
    doors: [{ side: 's', at: 0.5, width: 3 }, { side: 'e', at: 0.4 }, { side: 'w', at: 0.6 }], tier: 2, locked: { keyId: 'archive', name: 'Archiv', tier: 3 },
  });
  b.building({ id: 'cafe', name: 'Café', x: 35, y: 44, w: 8, h: 10, kind: 'store', doors: [{ side: 's', at: 0.5 }], tier: 1, maxRoom: 8 });

  // Supermarkt
  b.building({
    id: 'supermarkt', name: 'Supermarkt', x: 77, y: 37, w: 19, h: 16, kind: 'store',
    doors: [{ side: 's', at: 0.3, width: 3 }, { side: 'n', at: 0.7 }, { side: 'e', at: 0.5 }], tier: 1, maxRoom: 14, loot: 1.2,
  });
  for (let i = 0; i < 3; i++) b.car(79 + i * 6, 33, false, { wreck: i === 2, trunk: 0.3 });

  // Apotheke, Wohnblock
  b.building({
    id: 'apotheke', name: 'Apotheke', x: 36, y: 62, w: 14, h: 10, kind: 'pharmacy',
    doors: [{ side: 'n', at: 0.5 }], tier: 2, locked: { keyId: 'pharmacy', name: 'Apothekenlager', tier: 3 }, maxRoom: 9,
  });
  b.building({ id: 'wohnblock', name: 'Wohnblock', x: 53, y: 62, w: 17, h: 12, kind: 'house', doors: [{ side: 'n', at: 0.3 }, { side: 'e', at: 0.5 }], tier: 1, maxRoom: 6 });

  // Marktplatz
  b.fill({ x: 35, y: 76, w: 35, h: 10 }, T.CONCRETE);
  b.addZone({ id: 'marktplatz', name: 'Marktplatz', x: 35, y: 76, w: 35, h: 10, patrol: 1.3 });
  b.props.push({ type: 'fountain', x: C(45), y: C(80.5), w: TILE * 3, h: TILE * 3 });
  b.fill({ x: 44, y: 79, w: 3, h: 3 }, T.LOW);
  b.reserve({ x: 43, y: 78, w: 5, h: 5 });
  b.reserve({ x: 50, y: 78, w: 5, h: 5 });
  b.props.push({ type: 'manhole', x: C(52), y: C(80), w: TILE, h: TILE });
  for (const [x, y] of [
    [38, 77],
    [62, 77],
    [38, 84],
    [66, 84],
    [58, 84],
  ]) {
    b.set(x, y, T.TREE);
    b.props.push({ type: 'tree', x: C(x), y: C(y), w: TILE * 1.4, h: 0, v: 2 });
  }
  b.line(56, 79, 59, 79, T.LOW, 'bench');
  b.line(39, 81, 39, 82, T.LOW, 'bench');
  b.placeContainer('duffle', 61, 81, 1, false);

  // Polizei & Werkstatt
  b.building({
    id: 'polizei', name: 'Polizeiwache', x: 78, y: 62, w: 18, h: 12, kind: 'hq',
    doors: [{ side: 'n', at: 0.4 }, { side: 'e', at: 0.5 }], tier: 2, windows: 0.25, patrol: 1.2,
  });
  b.building({ id: 'werkstatt', name: 'Werkstatt', x: 99, y: 63, w: 10, h: 9, kind: 'garage', doors: [{ side: 'w', at: 0.5, width: 3 }], tier: 1, maxRoom: 10 });
  b.fill({ x: 78, y: 76, w: 30, h: 10 }, T.ASPHALT);
  b.addZone({ id: 'parkplatz', name: 'Parkplatz', x: 78, y: 76, w: 30, h: 10, patrol: 0.8 });
  for (let i = 0; i < 6; i++) b.car(79 + i * 5, 77, false, { trunk: 0.45 });
  b.car(80, 83, true);
  b.car(95, 83, true, { wreck: true });

  // Wohngebiet West
  const houses: [number, number, number, number][] = [
    [5, 34, 11, 9], [17, 46, 11, 8], [5, 46, 11, 8],
    [5, 62, 11, 9], [17, 62, 11, 9], [5, 74, 11, 9], [17, 74, 11, 9],
    [5, 93, 11, 9], [17, 93, 11, 9],
  ];
  houses.forEach(([x, y, w, h], i) => {
    const doorSide = y < 56 ? (y > 40 ? 's' : 'e') : y < 88 ? (i % 2 ? 'w' : 'e') : 'n';
    b.building({ id: 'haus' + i, name: 'Wohnhaus', x, y, w, h, kind: 'house', doors: [{ side: doorSide as 's' }, { side: i % 2 ? 'n' : 's', at: 0.25, width: 1 }], tier: 1 });
  });
  b.addZone({ id: 'wohngebiet', name: 'Wohngebiet', x: 3, y: 33, w: 27, h: 74, patrol: 1 });
  b.forest({ x: 3, y: 84, w: 26, h: 3 }, 0.06, 0.08);

  // Bauernhof
  b.building({ id: 'bauernhaus', name: 'Bauernhaus', x: 36, y: 94, w: 12, h: 9, kind: 'house', doors: [{ side: 'n', at: 0.4 }, { side: 'e', at: 0.6, width: 1 }], tier: 1 });
  b.building({ id: 'scheune', name: 'Scheune', x: 52, y: 93, w: 16, h: 11, kind: 'warehouse', doors: [{ side: 'n', at: 0.5, width: 3 }, { side: 'w', at: 0.6 }], tier: 1, wall: T.WALL, floor: T.DIRT });
  b.fill({ x: 36, y: 104, w: 33, h: 4 }, T.DIRT);
  b.addZone({ id: 'bauernhof', name: 'Bauernhof', x: 34, y: 92, w: 36, h: 16, patrol: 0.9 });
  b.crates(49, 96, 1, 2, { container: 'crate', tier: 1, prop: 'hay' });

  // Tankstelle
  b.fill({ x: 78, y: 92, w: 30, h: 15 }, T.CONCRETE);
  b.building({ id: 'tankstelle', name: 'Tankstelle', x: 90, y: 97, w: 13, h: 8, kind: 'store', doors: [{ side: 'n', at: 0.5 }], tier: 1, maxRoom: 9 });
  b.solidProp('pump', 83, 94, 1, 1);
  b.solidProp('pump', 87, 94, 1, 1);
  b.solidProp('pump', 83, 98, 1, 1);
  b.solidProp('pump', 87, 98, 1, 1);
  b.props.push({ type: 'canopy', x: 81 * TILE, y: 93 * TILE, w: 9 * TILE, h: 7 * TILE });
  b.addZone({ id: 'tankstelle_z', name: 'Tankstelle', x: 78, y: 92, w: 30, h: 15, patrol: 0.9 });

  // Industrie Ost
  b.fill({ x: 114, y: 60, w: 33, h: 40 }, T.CONCRETE);
  b.building({ id: 'lager', name: 'Lagerhalle', x: 116, y: 61, w: 28, h: 14, kind: 'warehouse', doors: [{ side: 'w', at: 0.5, width: 3 }, { side: 'n', at: 0.7 }, { side: 's', at: 0.2 }], tier: 2 });
  b.building({ id: 'fabrik', name: 'Fabrik', x: 116, y: 80, w: 28, h: 18, kind: 'factory', doors: [{ side: 'w', at: 0.4, width: 3 }, { side: 'n', at: 0.8 }, { side: 's', at: 0.5 }], tier: 2 });
  b.solidProp('truck', 128, 76, 6, 2, T.LOW, '#4a4a50');
  b.crates(137, 76, 2, 2, { container: 'crate', tier: 2 });
  b.crates(120, 77, 1, 1, { container: 'toolbox', tier: 2 });
  b.addZone({ id: 'industrie', name: 'Industriegebiet', x: 113, y: 60, w: 34, h: 40, tier: 2, patrol: 1.3 });
  // Schrottplatz
  b.fill({ x: 114, y: 100, w: 33, h: 8 }, T.DIRT);
  for (let i = 0; i < 5; i++) b.car(116 + i * 6, 101 + (i % 2), i % 2 === 0, { wreck: true, trunk: 0.5, tier: 1 });
  b.addZone({ id: 'schrott', name: 'Schrottplatz', x: 114, y: 99, w: 33, h: 9, patrol: 0.7 });

  // Funkturm
  b.building({ id: 'funkhaus', name: 'Funkstation', x: 127, y: 47, w: 7, h: 6, kind: 'shed', doors: [{ side: 'w', at: 0.5, width: 1 }], tier: 2 });
  b.props.push({ type: 'tower', x: C(138), y: C(50), w: TILE * 3, h: TILE * 3 });
  b.fill({ x: 137, y: 49, w: 3, h: 3 }, T.LOW);
  b.reserve({ x: 136, y: 48, w: 5, h: 5 });
  b.addZone({ id: 'funkturm', name: 'Funkturm', x: 124, y: 46, w: 22, h: 9, tier: 2, patrol: 0.8 });

  // Autos auf Straßen
  const roadCars: [number, number, boolean][] = [
    [10, 57, true], [24, 56, true], [40, 58, true], [60, 56, true], [88, 58, true], [100, 56, true], [128, 57, true], [140, 56, true],
    [73, 24, false], [72, 45, false], [74, 70, false], [72, 98, false],
    [31, 48, false], [30, 70, false], [31, 100, false], [111, 66, false], [110, 92, false],
    [20, 88, true], [50, 89, true], [96, 88, true], [45, 30, true], [62, 31, true], [88, 30, true],
  ];
  for (const [x, y, hz] of roadCars) {
    // Straßenreservierung für das Auto aufheben
    for (let yy = y - 1; yy < y + (hz ? 3 : 5); yy++) for (let xx = x - 1; xx < x + (hz ? 5 : 3); xx++) if (b.inB(xx, yy)) b.reserved[yy * W + xx] = 0;
    b.car(x, y, hz, { trunk: 0.35 });
  }

  // Wälder & Gebüsch
  b.forest({ x: 3, y: 7, w: 26, h: 26 }, 0.08, 0.05);
  b.forest({ x: 29, y: 7, w: 26, h: 21 }, 0.075, 0.05);
  b.forest({ x: 35, y: 34, w: 8, h: 9 }, 0.05, 0.06);
  b.forest({ x: 85, y: 8, w: 12, h: 20 }, 0.06, 0.06);
  b.forest({ x: 76, y: 20, w: 20, h: 9 }, 0.03, 0.05);
  b.forest({ x: 113, y: 46, w: 12, h: 9 }, 0.03, 0.07);
  b.forest({ x: 3, y: 102, w: 28, h: 6 }, 0.07, 0.05);
  b.forest({ x: 70, y: 100, w: 6, h: 8 }, 0.05, 0.05);
  b.forest({ x: 140, y: 46, w: 7, h: 9 }, 0.06, 0.05);
  b.addZone({ id: 'wald', name: 'Nordwald', x: 2, y: 6, w: 54, h: 27, patrol: 0.7 });
  b.scatter({ x: 2, y: 6, w: 145, h: 100 }, T.BUSH, 0.004, { prop: 'bush' });
  b.scatter({ x: 2, y: 6, w: 145, h: 100 }, T.ROCK, 0.0012, { prop: 'rock', on: [T.GRASS] });

  b.border(2);

  // Extraktionen
  b.extract({ id: 'west', name: 'Westlicher Waldweg', ...P(3.5, 57.5), r: 70, kind: 'open', desc: 'Immer offen.' });
  b.extract({ id: 'bahnhof', name: 'Bahnhof', ...P(72, 4.5), r: 70, kind: 'chance', chance: 0.75, desc: 'Nicht immer verfügbar.' });
  b.extract({ id: 'grenze', name: 'Grenzübergang', ...P(145.5, 57.5), r: 70, kind: 'timed', openAt: 10 * 60, desc: 'Öffnet nach 10 Minuten.' });
  b.extract({ id: 'tanke', name: 'Fluchtwagen Tankstelle', ...P(84, 103), r: 60, kind: 'paid', cost: 8000, desc: 'Kostet 8.000 € Bargeld.' });
  b.extract({ id: 'kanal', name: 'Kanalisation', ...P(52, 80), r: 45, kind: 'key', keyId: 'sewer', desc: 'Benötigt Kanalschacht-Schlüssel.' });
  b.extract({ id: 'heli', name: 'Heli-Landeplatz Basis', ...P(110.5, 27.5), r: 90, kind: 'heli', desc: 'Funkspruch absetzen, Heli abwarten, einsteigen.' });
  b.extract({ id: 'sued', name: 'Südfeld', ...P(56, 106), r: 70, kind: 'chance', chance: 0.5, desc: 'Nicht immer verfügbar.' });

  // Spieler-Spawns
  b.playerSpawns.push(P(6, 58), P(28, 104), P(64, 106), P(131, 106), P(8, 44), P(142, 72));

  // Bot-Spawns
  const scavs: [number, number][] = [
    [50, 82], [64, 80], [92, 80], [120, 78], [130, 104], [96, 95], [44, 100], [22, 70], [12, 80],
    [72, 20], [80, 26], [24, 40], [56, 58], [100, 58], [123, 57], [63, 46], [88, 54], [102, 68],
  ];
  for (const [x, y] of scavs) b.botSpawns.push({ ...P(x, y), kind: 'scav' });
  for (const [x, y] of [
    [8, 52], [140, 104], [60, 104], [92, 22], [146, 66], [4, 92],
  ] as [number, number][])
    b.botSpawns.push({ ...P(x, y), kind: 'pmc' });

  b.boss = {
    ...P(131, 21), name: 'Der Kommandant', chance: 0.7, weapon: 'm249', zone: 'hq',
    guards: [P(128, 20), P(134, 19), P(129, 27)],
  };

  return b.build();
}

// ======================================================================
// Industriehafen
// ======================================================================
function buildHafen(): GameMap {
  const W = 150;
  const H = 110;
  const b = new MapBuilder(mapMeta('hafen'), W, H, 0x4a7f21);
  b.fill({ x: 0, y: 0, w: W, h: H }, T.CONCRETE);
  for (let i = 0; i < 30; i++) b.ellipse(b.rng.int(5, W - 5), b.rng.int(5, 90), b.rng.range(2, 6), b.rng.range(2, 5), T.GRAVEL, 0.2);

  // Meer im Süden & Osten
  b.fill({ x: 0, y: 95, w: W, h: H - 95 }, T.WATER);
  b.fill({ x: 136, y: 0, w: W - 136, h: H }, T.WATER);
  // Kaikante
  b.fill({ x: 2, y: 92, w: 134, h: 3 }, T.DOCK);
  b.fill({ x: 133, y: 2, w: 3, h: 93 }, T.DOCK);
  // Stege
  b.fill({ x: 136, y: 18, w: 9, h: 3 }, T.DOCK);
  b.fill({ x: 136, y: 58, w: 9, h: 3 }, T.DOCK);
  b.fill({ x: 18, y: 95, w: 3, h: 10 }, T.DOCK);
  b.fill({ x: 108, y: 95, w: 3, h: 10 }, T.DOCK);
  b.reserve({ x: 0, y: 90, w: W, h: 20 });
  b.reserve({ x: 131, y: 0, w: 19, h: H });

  // Frachter
  b.building({
    id: 'frachter', name: 'Frachter "Morskaya"', x: 40, y: 97, w: 56, h: 11, kind: 'ship',
    doors: [{ side: 'n', at: 8, width: 2 }, { side: 'n', at: 44, width: 2 }], tier: 3, maxRoom: 12, minRoom: 3, patrol: 1.5, loot: 1.3,
  });
  b.fill({ x: 48, y: 95, w: 2, h: 2 }, T.DOCK);
  b.fill({ x: 84, y: 95, w: 2, h: 2 }, T.DOCK);
  b.addZone({ id: 'schiff', name: 'Frachter', x: 40, y: 95, w: 56, h: 13, tier: 3, patrol: 1.5 });

  // Bahngleis West
  b.fill({ x: 3, y: 3, w: 3, h: 88 }, T.RAIL);
  b.props.push({ type: 'rails_v', x: 4.5 * TILE, y: 3 * TILE, w: 0, h: 88 * TILE });
  b.solidProp('wagon_v', 3, 14, 2, 9, T.LOW, '#5d3b2a');
  b.solidProp('wagon_v', 3, 40, 2, 9, T.LOW, '#3b4d5d');
  b.solidProp('wagon_v', 3, 70, 2, 9, T.LOW, '#5d5a3b');
  b.reserve({ x: 2, y: 2, w: 5, h: 89 });

  // Straßen
  b.road({ x: 8, y: 34, w: 124, h: 4 }, { sidewalk: false });
  b.road({ x: 72, y: 2, w: 4, h: 32 }, { sidewalk: false });
  b.road({ x: 8, y: 86, w: 124, h: 3 }, { sidewalk: false });
  b.road({ x: 8, y: 2, w: 3, h: 86 }, { sidewalk: false });
  b.road({ x: 104, y: 38, w: 3, h: 48 }, { sidewalk: false });
  b.reserve({ x: 7, y: 33, w: 126, h: 6 });
  b.reserve({ x: 71, y: 2, w: 6, h: 32 });
  b.reserve({ x: 7, y: 85, w: 126, h: 5 });
  b.reserve({ x: 7, y: 2, w: 5, h: 86 });
  b.reserve({ x: 103, y: 38, w: 5, h: 48 });

  // Lagerhäuser Nord
  b.building({ id: 'lager1', name: 'Lagerhaus 1', x: 14, y: 5, w: 24, h: 13, kind: 'warehouse', doors: [{ side: 's', at: 0.5, width: 3 }, { side: 'e', at: 0.4 }], tier: 2 });
  b.building({ id: 'lager2', name: 'Lagerhaus 2', x: 42, y: 5, w: 26, h: 13, kind: 'warehouse', doors: [{ side: 's', at: 0.3, width: 3 }, { side: 'w', at: 0.5 }, { side: 'e', at: 0.6 }], tier: 2 });
  b.building({ id: 'lager3', name: 'Kühlhaus', x: 14, y: 21, w: 20, h: 10, kind: 'warehouse', doors: [{ side: 's', at: 0.5, width: 3 }, { side: 'n', at: 0.7 }], tier: 1, floor: T.METALFLOOR });
  b.building({ id: 'kantine', name: 'Hafenkantine', x: 40, y: 21, w: 14, h: 10, kind: 'store', doors: [{ side: 's', at: 0.5 }, { side: 'w', at: 0.5, width: 1 }], tier: 1, maxRoom: 8 });
  b.building({ id: 'werkhalle', name: 'Werkhalle', x: 57, y: 21, w: 12, h: 10, kind: 'garage', doors: [{ side: 's', at: 0.5, width: 3 }], tier: 1, maxRoom: 10 });
  b.addZone({ id: 'lagerviertel', name: 'Lagerviertel', x: 12, y: 3, w: 58, h: 30, tier: 2, patrol: 1.2 });

  // Zollamt (Tresor)
  b.building({
    id: 'zollamt', name: 'Zollamt', x: 82, y: 6, w: 24, h: 16, kind: 'customs',
    doors: [{ side: 'w', at: 0.5, width: 2 }, { side: 's', at: 0.4, width: 3 }], tier: 3, locked: { keyId: 'customs', name: 'Zolltresor', tier: 4 }, windows: 0.2, patrol: 1.3,
  });
  b.building({ id: 'wache', name: 'Wachhaus', x: 79, y: 25, w: 9, h: 7, kind: 'hq', doors: [{ side: 'e', at: 0.5, width: 1 }, { side: 'w', at: 0.5, width: 1 }], tier: 2, windows: 0.3 });
  b.fill({ x: 110, y: 6, w: 20, h: 22 }, T.ASPHALT);
  b.props.push({ type: 'helipad', x: C(119) - TILE / 2, y: C(15) - TILE / 2, w: TILE * 3, h: TILE * 3 });
  b.reserve({ x: 115, y: 11, w: 11, h: 11 });
  b.addZone({ id: 'zoll', name: 'Zollbereich', x: 80, y: 4, w: 52, h: 28, tier: 3, patrol: 1.2 });
  b.sandbags(112, 24, 5, true);
  b.sandbags(126, 8, 4, false);
  b.crates(128, 22, 2, 1, { container: 'ammobox', tier: 3, prop: 'milcrate' });

  // Hafenmeisterei
  b.building({
    id: 'hafenmeisterei', name: 'Hafenmeisterei', x: 110, y: 41, w: 18, h: 13, kind: 'harboroffice',
    doors: [{ side: 'w', at: 0.5 }, { side: 's', at: 0.6 }], tier: 2, locked: { keyId: 'harboroffice', name: 'Büro des Hafenmeisters', tier: 3 },
  });

  // Containerlabyrinth
  const colors = ['#8a3b2b', '#2b5a8a', '#3b7a3b', '#9a7a2b', '#5a5a5a', '#7a2b5a', '#2b7a7a', '#a35a2b'];
  b.addZone({ id: 'container', name: 'Containerlager', x: 14, y: 40, w: 86, h: 44, tier: 2, patrol: 1.5 });
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const x = 15 + col * 12;
      const y = 41 + row * 7;
      if (b.rng.chance(0.15)) continue;
      const roll = b.rng.next();
      if (roll < 0.18) {
        // begehbarer Container
        b.building({ id: `cont_${row}_${col}`, name: 'Offener Container', x, y, w: 9, h: 4, kind: 'container', doors: [{ side: b.rng.chance(0.5) ? 'w' : 'e', at: 1, width: 2 }], tier: 2, maxRoom: 40 });
      } else if (roll < 0.85) {
        const len = b.rng.int(6, 9);
        b.solidProp('shipcont', x, y + b.rng.int(0, 1), len, 3, T.WALL_METAL, b.rng.pick(colors));
      } else {
        b.crates(x + 1, y + 1, 3, 2, { container: b.rng.chance(0.5) ? 'crate' : 'toolbox', tier: 2 });
      }
    }
  }

  // Kräne an der Kaikante
  for (const x of [24, 60, 100, 122]) {
    b.solidProp('crane_leg', x, 88, 1, 1);
    b.solidProp('crane_leg', x + 5, 88, 1, 1);
    b.props.push({ type: 'crane', x: x * TILE, y: 86 * TILE, w: 6 * TILE, h: 10 * TILE });
  }
  // Ostkai
  b.building({ id: 'pumpenhaus', name: 'Pumpenhaus', x: 116, y: 62, w: 10, h: 8, kind: 'shed', doors: [{ side: 'w', at: 0.5 }], tier: 1 });
  b.building({ id: 'bootshaus', name: 'Bootshaus', x: 114, y: 74, w: 14, h: 9, kind: 'garage', doors: [{ side: 'w', at: 0.5, width: 3 }, { side: 'e', at: 0.5 }], tier: 2 });
  for (let i = 0; i < 6; i++) b.crates(b.rng.int(110, 128), b.rng.int(56, 60), 1, 1, { container: b.rng.chance(0.3) ? 'crate' : undefined, tier: 1, prop: 'barrel' });
  b.addZone({ id: 'ostkai', name: 'Ostkai', x: 108, y: 55, w: 25, h: 30, patrol: 1 });

  // Autos / Lkw
  for (const [x, y, hz] of [
    [20, 35, true], [44, 34, true], [90, 36, true], [118, 35, true], [9, 60, false], [73, 12, false], [60, 86, true], [92, 87, true], [105, 66, false],
  ] as [number, number, boolean][]) {
    for (let yy = y - 1; yy < y + (hz ? 3 : 5); yy++) for (let xx = x - 1; xx < x + (hz ? 5 : 3); xx++) if (b.inB(xx, yy)) b.reserved[yy * W + xx] = 0;
    b.car(x, y, hz, { trunk: 0.35 });
  }
  b.solidProp('truck', 30, 28, 6, 2, T.LOW, '#4a4a50');
  b.solidProp('truck', 92, 82, 6, 2, T.LOW, '#4a5040');

  b.scatter({ x: 12, y: 3, w: 120, h: 88 }, T.LOW, 0.002, { prop: 'barrel', on: [T.CONCRETE, T.GRAVEL] });
  b.border(2);
  // Wasser am Rand ist ohnehin unpassierbar, Rand trotzdem schließen
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b.get(x, y) === T.BORDER && (y > 93 || x > 134)) b.set(x, y, T.WATER);
  for (let x = 0; x < W; x++) {
    b.set(x, H - 1, T.BORDER);
    b.set(x, 0, T.BORDER);
  }
  for (let y = 0; y < H; y++) {
    b.set(W - 1, y, T.BORDER);
    b.set(0, y, T.BORDER);
  }

  // Extraktionen
  b.extract({ id: 'zolltor', name: 'Zolltor Nord', ...P(73.5, 3.5), r: 70, kind: 'open', desc: 'Immer offen.' });
  b.extract({ id: 'gleis', name: 'Gleisanlage', ...P(4.5, 88), r: 70, kind: 'timed', openAt: 12 * 60, desc: 'Öffnet nach 12 Minuten.' });
  b.extract({ id: 'boot', name: 'Schnellboot Ostanleger', ...P(143, 59.5), r: 60, kind: 'paid', cost: 12000, desc: 'Kostet 12.000 € Bargeld.' });
  b.extract({ id: 'pier', name: 'Westpier', ...P(19.5, 103), r: 60, kind: 'chance', chance: 0.6, desc: 'Nicht immer verfügbar.' });
  b.extract({ id: 'heli', name: 'Heli-Landeplatz Zoll', ...P(119.5, 15.5), r: 90, kind: 'heli', desc: 'Funkspruch absetzen, Heli abwarten, einsteigen.' });
  b.extract({ id: 'nordsteg', name: 'Nordsteg', ...P(143, 19.5), r: 55, kind: 'chance', chance: 0.5, desc: 'Nicht immer verfügbar.' });

  b.playerSpawns.push(P(9, 20), P(9, 75), P(30, 3.5 + 0), P(126, 30), P(60, 3.5), P(128, 88));

  for (const [x, y] of [
    [30, 45], [55, 52], [80, 62], [40, 72], [90, 47], [65, 78], [25, 30], [60, 25], [100, 30], [120, 60], [115, 85], [50, 88], [75, 88], [88, 70],
  ] as [number, number][])
    b.botSpawns.push({ ...P(x, y), kind: 'scav' });
  for (const [x, y] of [
    [10, 40], [126, 30], [74, 5], [12, 86], [100, 88],
  ] as [number, number][])
    b.botSpawns.push({ ...P(x, y), kind: 'pmc' });

  b.boss = {
    ...P(68, 102), name: 'Kapitän Volkov', chance: 0.7, weapon: 'saiga', zone: 'frachter',
    guards: [P(62, 102), P(74, 102), P(68, 99)],
  };

  return b.build();
}
