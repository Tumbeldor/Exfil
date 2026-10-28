import { ADS_MULT, HEAD_MULT, SPRINT_MULT, WALK_SPEED } from '../constants';
import { inventoryWeight, type Inventory } from '../inventory';
import { type ArmorDef, type ItemStack, type WeaponDef, ammoDef, isArmor, itemDef, weaponDef } from '../items';
import { clamp } from '../math';
import type { Rng } from '../rng';

/** Aktuelle Streuung in Grad. */
export function currentSpread(w: WeaponDef, bloom: number, moving: boolean, sprint: boolean, ads: boolean): number {
  let s = w.spread + bloom;
  if (moving) s += w.moveSpread;
  if (sprint) s += w.moveSpread * 2 + 4;
  if (ads) s *= 0.55;
  return s;
}

/** Erzeugt die Projektilwinkel eines Schusses. */
export function shotAngles(aim: number, spreadDeg: number, pellets: number, rng: { gauss(sd: number): number }): number[] {
  const out: number[] = [];
  const rad = (spreadDeg * Math.PI) / 180;
  for (let i = 0; i < pellets; i++) {
    const g = clamp(rng.gauss(rad * 0.45), -rad, rad);
    out.push(aim + g);
  }
  return out;
}

export function activeWeapon(inv: Inventory, active: 'primary' | 'secondary'): ItemStack | undefined {
  return inv.equip[active] ?? inv.equip[active === 'primary' ? 'secondary' : 'primary'];
}

export function activeWeaponDef(inv: Inventory, active: 'primary' | 'secondary'): WeaponDef | undefined {
  const it = activeWeapon(inv, active);
  return it ? weaponDef(it.id) : undefined;
}

export interface SpeedParams {
  inv: Inventory;
  sprint: boolean;
  ads: boolean;
  stim: boolean;
  downed: boolean;
  acting: boolean;
  stamina: number;
}

/** Geschwindigkeit (Einheiten/s) eines Spielers – identisch auf Client (Vorhersage) und Server (Validierung). */
export function actorSpeed(p: SpeedParams): number {
  if (p.downed) return WALK_SPEED * 0.28;
  let s = WALK_SPEED;
  const weight = inventoryWeight(p.inv);
  s *= 1 - clamp((weight - 22) / 70, 0, 0.32);
  for (const slot of ['armor', 'helmet'] as const) {
    const it = p.inv.equip[slot];
    if (it) {
      const d = itemDef(it.id) as ArmorDef;
      s *= 1 - d.speedPenalty;
    }
  }
  if (p.stim) s *= 1.18;
  if (p.acting) s *= 0.5;
  if (p.ads) s *= ADS_MULT;
  else if (p.sprint && (p.stamina > 1 || p.stim)) s *= SPRINT_MULT;
  return s;
}

export interface HitResult {
  dmg: number;
  head: boolean;
  armorHit: boolean;
  penetrated: boolean;
  bleed: boolean;
}

/**
 * Trefferberechnung mit Panzerung (Tarkov-ähnlich): Durchschlagschance hängt von
 * Durchschlag vs. effektiver Schutzklasse ab; geblockte Treffer verursachen stumpfen Schaden.
 */
export function computeHit(
  inv: Inventory,
  dmg: number,
  pen: number,
  armorDmgFactor: number,
  headChance: number,
  rng: Rng,
): HitResult {
  const head = rng.next() < headChance;
  const piece = head ? inv.equip.helmet : inv.equip.armor;
  let final = dmg;
  let armorHit = false;
  let penetrated = true;
  if (piece && (piece.dur ?? 0) > 0) {
    const d = itemDef(piece.id);
    if (isArmor(d)) {
      armorHit = true;
      const durFrac = (piece.dur ?? 0) / d.dur;
      const eff = d.cls * 10 * (0.6 + 0.4 * durFrac);
      const chance = clamp(0.5 + (pen - eff) / 20, 0.03, 0.97);
      penetrated = rng.next() < chance;
      if (penetrated) {
        final = dmg * (1 - 0.035 * d.cls);
        piece.dur = Math.max(0, (piece.dur ?? 0) - dmg * armorDmgFactor * 0.45);
      } else {
        final = dmg * (head ? 0.3 : 0.2);
        piece.dur = Math.max(0, (piece.dur ?? 0) - dmg * armorDmgFactor * 0.8);
      }
    }
  }
  if (head) final *= HEAD_MULT;
  const bleed = penetrated && final >= 18 && rng.next() < 0.3;
  return { dmg: final, head, armorHit, penetrated, bleed };
}

export function ammoStats(ammoId: string) {
  return ammoDef(ammoId);
}
