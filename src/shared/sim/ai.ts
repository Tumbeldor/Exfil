import { TILE, WALK_SPEED } from '../constants';
import { countItem } from '../inventory';
import { type MedDef, isGrenade, isMed, itemDef, weaponDef, type WeaponClass } from '../items';
import type { BotType } from '../loot';
import { angleDiff, clamp, dist, segmentCircle, turnTowards } from '../math';
import { F_SLOW, TILE_FLAGS } from '../map/tiles';
import { activeWeapon } from './combat';
import type { Actor, BotSkill, Brain } from './types';
import type { World } from './World';

const DEG = Math.PI / 180;

const BASE: Record<BotType, BotSkill> = {
  scav: { view: 650, fov: 115 * DEG, react: 1.05, aimErr: 0.14, turn: 4.8, speed: 0.92, burstMin: 2, burstMax: 4, aggression: 0.5, hearing: 1 },
  pmc: { view: 820, fov: 130 * DEG, react: 0.72, aimErr: 0.095, turn: 6.4, speed: 1.0, burstMin: 3, burstMax: 5, aggression: 0.75, hearing: 1.2 },
  guard: { view: 780, fov: 125 * DEG, react: 0.72, aimErr: 0.092, turn: 6.4, speed: 0.95, burstMin: 3, burstMax: 6, aggression: 0.55, hearing: 1.15 },
  boss: { view: 880, fov: 140 * DEG, react: 0.52, aimErr: 0.064, turn: 7.4, speed: 0.92, burstMin: 4, burstMax: 9, aggression: 0.8, hearing: 1.3 },
};

export function botSkill(type: BotType, difficulty: number): BotSkill {
  const s = { ...BASE[type] };
  const m = [
    { react: 1.45, aim: 1.5, view: 0.85 },
    { react: 1, aim: 1, view: 1 },
    { react: 0.78, aim: 0.74, view: 1.1 },
  ][clamp(difficulty, 0, 2)];
  s.react *= m.react;
  s.aimErr *= m.aim;
  s.view *= m.view;
  return s;
}

export function makeBrain(world: World, a: Actor, squad: number, leader: number | null, home: { x: number; y: number }, leash: number, zone: string | null): Brain {
  const guard = a.botType === 'guard' || a.botType === 'boss';
  return {
    state: guard ? 'guard' : 'patrol',
    stateT: 0,
    path: null,
    pathI: 0,
    goal: null,
    repathT: 0,
    target: null,
    lastSeen: null,
    awareness: 0,
    reactT: 0,
    trackT: 0,
    burst: 3,
    burstPause: 0,
    strafeDir: 0,
    strafeT: 0,
    idleT: world.rng.range(0, 3),
    thinkT: world.rng.range(0, 0.2),
    home: { ...home },
    leash,
    leader,
    squad,
    grenadeCd: world.rng.range(4, 12),
    stuckT: 0,
    lastX: a.x,
    lastY: a.y,
    lookA: a.aim,
    lookT: 0,
    healCd: 0,
    heard: null,
    visible: false,
    lod: 0,
    skill: botSkill(a.botType ?? 'scav', world.cfg.difficulty),
    zone,
  };
}

function prefRange(w: WeaponClass | undefined): [number, number] {
  switch (w) {
    case 'shotgun':
      return [70, 230];
    case 'pistol':
      return [120, 380];
    case 'smg':
      return [130, 420];
    case 'dmr':
    case 'sniper':
      return [380, 820];
    case 'lmg':
      return [220, 650];
    default:
      return [200, 560];
  }
}

function setState(br: Brain, s: Brain['state']) {
  if (br.state === s) return;
  br.state = s;
  br.stateT = 0;
  br.path = null;
  br.goal = null;
}

function canSee(world: World, a: Actor, p: Actor, d: number): boolean {
  const br = a.brain!;
  let range = br.skill.view;
  if (TILE_FLAGS[world.map.tileAtWorld(p.x, p.y)] & F_SLOW) range *= p.moving ? 0.6 : 0.4;
  if (p.downed) range *= 0.8;
  if (d > range) return false;
  if (d > 150) {
    const ang = Math.atan2(p.y - a.y, p.x - a.x);
    const fov = br.state === 'combat' || br.state === 'search' ? br.skill.fov * 1.25 : br.skill.fov;
    if (Math.abs(angleDiff(a.aim, ang)) > fov / 2) return false;
  }
  return world.map.canSee(a.x, a.y, p.x, p.y);
}

function perceive(world: World, a: Actor, interval: number) {
  const br = a.brain!;
  let best: Actor | null = null;
  let bestScore = Infinity;
  let bestD = 0;
  for (const p of world.actors.values()) {
    if (!p.alive || p.extracted || !world.hostile(a, p)) continue;
    const d = dist(a.x, a.y, p.x, p.y);
    if (d > br.skill.view * 1.05) continue;
    // Gehör: sprintende Spieler in der Nähe
    if (d < 260 * br.skill.hearing && p.sprint && p.moving && br.state !== 'combat') {
      br.heard = { x: p.x, y: p.y, t: world.t };
      if (br.state === 'patrol' || br.state === 'idle' || br.state === 'guard') setState(br, 'investigate');
    }
    if (!canSee(world, a, p, d)) continue;
    const score = d * (p.downed ? 2.5 : 1) * (p.id === br.target ? 0.7 : 1);
    if (score < bestScore) {
      bestScore = score;
      best = p;
      bestD = d;
    }
  }
  if (best) {
    br.visible = true;
    br.lastSeen = { x: best.x, y: best.y, t: world.t };
    const rate = (bestD < 200 ? 4.5 : bestD < 450 ? 2.2 : 1.2) * (best.sprint ? 1.3 : 1) * (br.state === 'combat' || br.state === 'search' ? 6 : 1);
    br.awareness = Math.min(1, br.awareness + rate * interval);
    if (br.awareness >= 1) {
      if (br.state !== 'combat' && br.state !== 'retreat') {
        enterCombat(world, a, best);
        alertSquad(world, a, best);
      } else if (br.target !== best.id) {
        br.target = best.id;
        br.trackT = 0;
      }
    } else {
      // misstrauisch: hinsehen
      br.lookA = Math.atan2(best.y - a.y, best.x - a.x);
      br.lookT = 1;
    }
  } else {
    br.visible = false;
    br.awareness = Math.max(0, br.awareness - 0.3 * interval);
  }
}

function enterCombat(world: World, a: Actor, target: Actor) {
  const br = a.brain!;
  setState(br, 'combat');
  br.target = target.id;
  br.reactT = br.skill.react * world.rng.range(0.8, 1.3);
  br.trackT = 0;
  br.burst = world.rng.int(br.skill.burstMin, br.skill.burstMax);
  br.awareness = 1;
}

function alertSquad(world: World, a: Actor, target: Actor) {
  for (const m of world.actors.values()) {
    if (m === a || !m.brain || m.brain.squad !== a.brain!.squad) continue;
    if (dist(m.x, m.y, a.x, a.y) > 1100) continue;
    const mb = m.brain;
    if (mb.state === 'combat' || mb.state === 'retreat') continue;
    mb.lastSeen = { x: target.x, y: target.y, t: world.t };
    mb.target = target.id;
    setState(mb, 'search');
  }
}

export function onBotDamaged(world: World, a: Actor, attacker: Actor) {
  const br = a.brain;
  if (!br || !world.hostile(a, attacker)) return;
  br.awareness = 1;
  const err = world.rng.range(-70, 70);
  br.lastSeen = { x: attacker.x + err, y: attacker.y - err, t: world.t };
  if (br.state !== 'combat' && br.state !== 'retreat') {
    enterCombat(world, a, attacker);
    br.reactT *= 0.6;
    br.visible = false;
    alertSquad(world, a, attacker);
  }
  if (a.hp < a.maxHp * 0.4 && br.healCd <= 0 && br.state === 'combat' && hasMed(a) && world.rng.chance(0.6)) setState(br, 'retreat');
}

/** Lärm (Schüsse, Explosionen, Heli) lockt Bots an. */
export function alertNoise(world: World, x: number, y: number, radius: number, source?: Actor, loud = false) {
  for (const b of world.actors.values()) {
    const br = b.brain;
    if (!br || b === source) continue;
    const d = dist(b.x, b.y, x, y);
    if (d > radius * br.skill.hearing) continue;
    if (br.state === 'combat' || br.state === 'retreat') continue;
    if (source && source.team === b.team) {
      // Verbündete schießen: zum Ziel des Verbündeten
      const sb = source.brain;
      if (sb?.lastSeen && sb.state === 'combat' && d < 900) {
        br.heard = { x: sb.lastSeen.x, y: sb.lastSeen.y, t: world.t };
        if (br.state !== 'search') setState(br, 'investigate');
      }
      continue;
    }
    if (br.leash && dist(br.home.x, br.home.y, x, y) > br.leash * 1.6 && !loud) continue;
    const e = d * 0.12;
    br.heard = { x: x + world.rng.range(-e, e), y: y + world.rng.range(-e, e), t: world.t };
    if (br.state !== 'search') setState(br, 'investigate');
    br.lookA = Math.atan2(y - b.y, x - b.x);
    br.lookT = 1.5;
  }
}

function hasMed(a: Actor) {
  return a.inv.bag.some((it) => {
    const d = itemDef(it.id);
    return isMed(d) && (d as MedDef).heal > 0 && !(d as MedDef).revive;
  });
}

function requestPath(world: World, a: Actor, gx: number, gy: number): boolean {
  const br = a.brain!;
  if (world.pathBudget <= 0) return false;
  world.pathBudget--;
  const p = world.nav.findPath(a.x, a.y, gx, gy, 6000, a.r);
  br.path = p && p.length ? p : null;
  br.pathI = 0;
  br.goal = { x: gx, y: gy };
  br.repathT = 0;
  return !!br.path;
}

/** Bewegt den Bot entlang seines Pfades. Gibt true zurück, wenn das Ziel erreicht ist. */
function followPath(world: World, a: Actor, speedMul: number, dt: number, face = true): boolean {
  const br = a.brain!;
  if (!br.path) return true;
  const wp = br.path[br.pathI];
  if (!wp) {
    br.path = null;
    return true;
  }
  const dx = wp.x - a.x;
  const dy = wp.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 10) {
    br.pathI++;
    if (br.pathI >= br.path.length) {
      br.path = null;
      return true;
    }
    return false;
  }
  moveDir(world, a, dx / d, dy / d, speedMul, dt);
  if (face) a.aim = turnTowards(a.aim, Math.atan2(dy, dx), br.skill.turn * 0.6 * dt);
  return false;
}

function moveDir(world: World, a: Actor, nx: number, ny: number, speedMul: number, dt: number) {
  const br = a.brain!;
  const slow = TILE_FLAGS[world.map.tileAtWorld(a.x, a.y)] & F_SLOW ? 0.75 : 1;
  const sp = WALK_SPEED * br.skill.speed * speedMul * slow * (a.action ? 0.5 : 1);
  const p = world.map.moveCircle(a.x, a.y, nx * sp * dt, ny * sp * dt, a.r);
  a.vx = (p.x - a.x) / dt;
  a.vy = (p.y - a.y) / dt;
  a.x = p.x;
  a.y = p.y;
  a.moving = true;
  a.sprint = speedMul > 1.15;
}

function randomPointInZone(world: World, a: Actor): { x: number; y: number } | null {
  const m = world.map;
  const br = a.brain!;
  if (br.leash > 0) {
    for (let i = 0; i < 12; i++) {
      const ang = world.rng.range(0, Math.PI * 2);
      const r = world.rng.range(0, br.leash * 0.6);
      const x = br.home.x + Math.cos(ang) * r;
      const y = br.home.y + Math.sin(ang) * r;
      if (m.walkable(Math.floor(x / TILE), Math.floor(y / TILE))) return { x, y };
    }
    return null;
  }
  const zones = m.zones.filter((z) => z.patrol > 0);
  const z = world.rng.weighted(zones, (zz) => {
    const cx = (zz.x + zz.w / 2) * TILE;
    const cy = (zz.y + zz.h / 2) * TILE;
    const d = dist(a.x, a.y, cx, cy);
    return (zz.patrol * (0.4 + Math.min(1, (zz.w * zz.h) / 200))) / (1 + d / 1300);
  });
  if (!z) return null;
  for (let i = 0; i < 14; i++) {
    const tx = world.rng.int(z.x, z.x + z.w - 1);
    const ty = world.rng.int(z.y, z.y + z.h - 1);
    if (m.walkable(tx, ty)) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
  }
  return null;
}

function friendlyInLine(world: World, a: Actor, tx: number, ty: number): boolean {
  const dx = tx - a.x;
  const dy = ty - a.y;
  for (const o of world.actors.values()) {
    if (o === a || o.team !== a.team || !o.alive) continue;
    if (Math.abs(o.x - a.x) > Math.abs(dx) + 30 && Math.abs(o.y - a.y) > Math.abs(dy) + 30) continue;
    const t = segmentCircle(a.x, a.y, dx, dy, o.x, o.y, o.r + 6);
    if (t >= 0 && t < 1) return true;
  }
  return false;
}

function findCover(world: World, a: Actor, fromX: number, fromY: number): { x: number; y: number } | null {
  const m = world.map;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let i = 0; i < 22; i++) {
    const ang = world.rng.range(0, Math.PI * 2);
    const r = world.rng.range(3, 9) * TILE;
    const x = a.x + Math.cos(ang) * r;
    const y = a.y + Math.sin(ang) * r;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (!m.walkable(tx, ty)) continue;
    const cx = (tx + 0.5) * TILE;
    const cy = (ty + 0.5) * TILE;
    if (m.canSee(fromX, fromY, cx, cy)) continue;
    const d = dist(a.x, a.y, cx, cy) - dist(fromX, fromY, cx, cy) * 0.3;
    if (d < bestD) {
      bestD = d;
      best = { x: cx, y: cy };
    }
  }
  return best;
}

function nearestPlayerDist(world: World, a: Actor) {
  let best = Infinity;
  for (const p of world.actors.values()) {
    if (p.kind !== 'player' || !p.alive) continue;
    const d = dist(a.x, a.y, p.x, p.y);
    if (d < best) best = d;
  }
  return best;
}

export function updateBot(world: World, a: Actor, dt: number) {
  const br = a.brain!;
  a.moving = false;
  a.sprint = false;
  a.vx = 0;
  a.vy = 0;

  // Detailstufe: weit entfernte Bots seltener simulieren
  const far = nearestPlayerDist(world, a) > 2600 && br.state !== 'combat';
  if (far) {
    br.lod += dt;
    if (br.lod < 0.25) return;
    dt = br.lod;
    br.lod = 0;
  }

  br.stateT += dt;
  br.thinkT -= dt;
  br.grenadeCd -= dt;
  br.healCd -= dt;
  br.burstPause -= dt;
  br.strafeT -= dt;
  br.repathT += dt;
  br.lookT -= dt;

  if (br.thinkT <= 0) {
    const iv = 0.14 + world.rng.next() * 0.08;
    br.thinkT = iv;
    perceive(world, a, iv);
  }

  // Heilung läuft: stehen bleiben
  if (a.action) {
    if (br.lastSeen) a.aim = turnTowards(a.aim, Math.atan2(br.lastSeen.y - a.y, br.lastSeen.x - a.x), br.skill.turn * dt);
    return;
  }

  const w = activeWeapon(a.inv, a.active);
  const wd = w ? weaponDef(w.id) : undefined;

  switch (br.state) {
    case 'patrol':
    case 'guard':
      patrol(world, a, dt);
      break;
    case 'idle':
      if (br.stateT > br.idleT) setState(br, br.leash ? 'guard' : 'patrol');
      lookAround(world, a, dt);
      break;
    case 'investigate': {
      if (!br.heard || br.stateT > 28) {
        setState(br, br.leash ? 'guard' : 'patrol');
        break;
      }
      if (!br.path && (!br.goal || dist(br.goal.x, br.goal.y, br.heard.x, br.heard.y) > 60)) requestPath(world, a, br.heard.x, br.heard.y);
      const done = followPath(world, a, 1.05, dt);
      if (done && br.goal) {
        lookAround(world, a, dt);
        if (dist(a.x, a.y, br.heard.x, br.heard.y) < 90 || br.stateT > 12) {
          br.heard = null;
          br.idleT = world.rng.range(3, 6);
          setState(br, 'idle');
        }
      } else if (!br.path && br.repathT > 1.5) requestPath(world, a, br.heard.x, br.heard.y);
      break;
    }
    case 'search': {
      if (!br.lastSeen || br.stateT > 24) {
        setState(br, br.leash ? 'guard' : 'patrol');
        br.target = null;
        break;
      }
      if (br.leash && dist(br.home.x, br.home.y, br.lastSeen.x, br.lastSeen.y) > br.leash * 1.5) {
        setState(br, 'guard');
        break;
      }
      if (!br.path && (!br.goal || br.repathT > 2)) requestPath(world, a, br.lastSeen.x, br.lastSeen.y);
      const done = followPath(world, a, 1.1, dt);
      if (done && dist(a.x, a.y, br.lastSeen.x, br.lastSeen.y) < 80) {
        br.lastSeen = null;
        br.idleT = world.rng.range(4, 8);
        setState(br, 'idle');
      }
      tryReloadIdle(world, a);
      break;
    }
    case 'retreat':
      retreat(world, a, dt);
      break;
    case 'combat':
      combat(world, a, dt, wd);
      break;
  }

  // Festhängen erkennen
  if (br.path) {
    const moved = dist(a.x, a.y, br.lastX, br.lastY);
    if (moved < 0.4 * dt * 60) br.stuckT += dt;
    else br.stuckT = Math.max(0, br.stuckT - dt);
    if (br.stuckT > 1.4) {
      br.stuckT = 0;
      br.path = null;
      br.goal = null;
      br.strafeDir = -br.strafeDir || 1;
    }
  }
  br.lastX = a.x;
  br.lastY = a.y;
}

function lookAround(world: World, a: Actor, dt: number) {
  const br = a.brain!;
  if (br.lookT <= 0) {
    br.lookA = a.aim + world.rng.range(-1.6, 1.6);
    br.lookT = world.rng.range(1, 2.5);
  }
  a.aim = turnTowards(a.aim, br.lookA, br.skill.turn * 0.35 * dt);
}

function patrol(world: World, a: Actor, dt: number) {
  const br = a.brain!;
  tryReloadIdle(world, a);
  // Truppführer folgen
  if (br.leader !== null) {
    const leader = world.actors.get(br.leader);
    if (!leader || !leader.alive) {
      br.leader = null;
    } else if (!br.leash) {
      const d = dist(a.x, a.y, leader.x, leader.y);
      if (d > 95) {
        if (!br.path || br.repathT > 1.2) {
          const off = (a.id % 3) - 1;
          requestPath(world, a, leader.x - Math.cos(leader.aim) * 40 + off * 30, leader.y - Math.sin(leader.aim) * 40 + off * 30);
        }
        followPath(world, a, d > 260 ? 1.25 : 0.75, dt);
      } else {
        br.path = null;
        lookAround(world, a, dt);
      }
      return;
    }
  }
  if (br.idleT > 0) {
    br.idleT -= dt;
    lookAround(world, a, dt);
    return;
  }
  if (!br.path) {
    const p = randomPointInZone(world, a);
    if (!p || !requestPath(world, a, p.x, p.y)) {
      br.idleT = 0.5;
      return;
    }
  }
  if (followPath(world, a, br.leash ? 0.5 : 0.62, dt)) {
    br.idleT = world.rng.range(2, br.leash ? 8 : 6);
  }
  if (br.lookT > 0) a.aim = turnTowards(a.aim, br.lookA, br.skill.turn * dt);
}

function tryReloadIdle(world: World, a: Actor) {
  const w = activeWeapon(a.inv, a.active);
  if (!w || a.ws.reloadT > 0) return;
  const wd = weaponDef(w.id);
  if ((w.mag ?? 0) < wd.mag * 0.5) world.startReload(a);
}

function retreat(world: World, a: Actor, dt: number) {
  const br = a.brain!;
  const from = br.lastSeen ?? { x: a.x + 1, y: a.y };
  if (br.stateT < dt * 1.5) {
    const c = findCover(world, a, from.x, from.y);
    if (!c || !requestPath(world, a, c.x, c.y)) {
      setState(br, 'combat');
      br.healCd = 6;
      return;
    }
  }
  const done = followPath(world, a, 1.3, dt, false);
  a.aim = turnTowards(a.aim, Math.atan2(from.y - a.y, from.x - a.x), br.skill.turn * dt);
  if (done || br.stateT > 6) {
    const med = a.inv.bag.find((it) => {
      const d = itemDef(it.id);
      return isMed(d) && (d as MedDef).heal > 0 && !(d as MedDef).revive;
    });
    if (med && a.hp < a.maxHp * 0.8) world.useItem(a, med.uid);
    br.healCd = 18;
    setState(br, br.target !== null ? 'search' : 'patrol');
  }
}

function combat(world: World, a: Actor, dt: number, wd: ReturnType<typeof weaponDef> | undefined) {
  const br = a.brain!;
  const t = br.target !== null ? world.actors.get(br.target) : undefined;
  if (!t || !t.alive || t.extracted) {
    br.target = null;
    br.awareness = 0.3;
    setState(br, br.lastSeen ? 'search' : br.leash ? 'guard' : 'patrol');
    return;
  }
  const d = dist(a.x, a.y, t.x, t.y);
  const [pmin, pmax] = prefRange(wd?.wclass);
  if (br.visible && br.lastSeen && world.t - br.lastSeen.t < 0.4) {
    br.trackT += dt;
    // leichte Vorhaltung
    const lead = d / (wd?.bulletSpeed ?? 1800);
    const tx = t.x + t.vx * lead * 0.6;
    const ty = t.y + t.vy * lead * 0.6;
    const desired = Math.atan2(ty - a.y, tx - a.x);
    a.aim = turnTowards(a.aim, desired, br.skill.turn * dt);
    const off = Math.abs(angleDiff(a.aim, desired));
    br.reactT -= dt;
    if (br.reactT <= 0 && off < 0.14 && wd && d < wd.range * 0.95 && br.burstPause <= 0) {
      if (!friendlyInLine(world, a, t.x, t.y)) {
        const speed = Math.hypot(t.vx, t.vy);
        let err = br.skill.aimErr * (1.6 - Math.min(1, br.trackT / 2.4) * 0.9) * (1 + speed / 320);
        if (TILE_FLAGS[world.map.tileAtWorld(t.x, t.y)] & F_SLOW) err *= 1.35;
        if (d > 600) err *= 1.2;
        if (t.downed) err *= 0.7;
        if (world.botFire(a, err)) {
          br.burst--;
          if (br.burst <= 0) {
            br.burst = world.rng.int(br.skill.burstMin, br.skill.burstMax);
            br.burstPause = wd.auto ? world.rng.range(0.45, 1.1) : world.rng.range(0.2, 0.6);
          }
        }
      } else {
        br.strafeT = 0;
      }
    }
    // Rückzug zum Heilen
    if (a.hp < a.maxHp * 0.38 && br.healCd <= 0 && hasMed(a)) {
      setState(br, 'retreat');
      return;
    }
    // Bewegung
    const leashed = br.leash > 0 && dist(a.x, a.y, br.home.x, br.home.y) > br.leash * 1.3;
    if (d > pmax && !leashed) {
      if (!br.path || br.repathT > 0.9) requestPath(world, a, t.x, t.y);
      followPath(world, a, 1, dt, false);
    } else if (d < pmin) {
      const nx = (a.x - t.x) / (d || 1);
      const ny = (a.y - t.y) / (d || 1);
      moveDir(world, a, nx * 0.8 + -ny * br.strafeDir * 0.4, ny * 0.8 + nx * br.strafeDir * 0.4, 0.8, dt);
    } else {
      if (br.strafeT <= 0) {
        br.strafeT = world.rng.range(0.5, 1.4);
        const r = world.rng.next();
        br.strafeDir = r < 0.4 ? -1 : r < 0.8 ? 1 : 0;
      }
      if (br.strafeDir !== 0) {
        const nx = -Math.sin(Math.atan2(t.y - a.y, t.x - a.x)) * br.strafeDir;
        const ny = Math.cos(Math.atan2(t.y - a.y, t.x - a.x)) * br.strafeDir;
        const bx = a.x;
        const by = a.y;
        moveDir(world, a, nx, ny, 0.75, dt);
        if (Math.abs(a.x - bx) + Math.abs(a.y - by) < 0.5) br.strafeDir = -br.strafeDir;
      }
    }
    br.path = d > pmax && !leashed ? br.path : null;
  } else {
    // Ziel aus den Augen verloren
    br.trackT = 0;
    const ls = br.lastSeen;
    if (ls) {
      a.aim = turnTowards(a.aim, Math.atan2(ls.y - a.y, ls.x - a.x), br.skill.turn * dt);
      const since = world.t - ls.t;
      const ld = dist(a.x, a.y, ls.x, ls.y);
      if (since > 0.9 && br.grenadeCd <= 0 && ld > 120 && ld < 400 && countGrenades(a) > 0 && world.rng.chance(0.55)) {
        world.throwGrenade(a, ls.x, ls.y);
        consumeBotGrenade(a);
        br.grenadeCd = world.rng.range(12, 20);
      } else if (since > 0.9) br.grenadeCd = Math.max(br.grenadeCd, 1);
      if (since > 1.6) {
        setState(br, 'search');
        br.target = t.id;
      }
    } else setState(br, 'search');
    tryReloadIdle(world, a);
  }
}

function countGrenades(a: Actor) {
  return a.inv.bag.filter((it) => isGrenade(itemDef(it.id))).reduce((s, it) => s + it.n, 0) || countItem(a.inv, 'frag');
}
function consumeBotGrenade(a: Actor) {
  const g = a.inv.bag.find((it) => isGrenade(itemDef(it.id)));
  if (!g) return;
  g.n--;
  if (g.n <= 0) a.inv.bag.splice(a.inv.bag.indexOf(g), 1);
}

