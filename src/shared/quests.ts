import type { WeaponClass } from './items';
import type { BotType } from './loot';
import type { ContainerKind } from './map/GameMap';
import type { TraderId } from './progression';
import type { RaidResult } from './sim/types';

export type Objective =
  | { type: 'kill'; target: BotType | 'any'; count: number; map?: string; wclass?: WeaponClass[]; head?: boolean; text: string }
  | { type: 'extract'; count: number; map?: string; extract?: string; text: string }
  | { type: 'search'; count: number; kind?: ContainerKind[]; map?: string; text: string }
  | { type: 'visit'; zone: string; map: string; text: string }
  | { type: 'handover'; item: string; count: number; text: string };

export interface QuestDef {
  id: string;
  title: string;
  giver: TraderId;
  level: number;
  prereq?: string[];
  desc: string;
  objectives: Objective[];
  rewards: { money: number; xp: number; items?: { id: string; n: number }[]; unlock?: string };
}

export const QUESTS: QuestDef[] = [
  {
    id: 'q_intro', title: 'Erste Schritte', giver: 'brandt', level: 1,
    desc: 'Beweis mir, dass du lebend aus der Zone zurückkommst. Rein, Beute machen, raus.',
    objectives: [{ type: 'extract', count: 1, text: 'Überlebe einen Raid (Extraktion)' }],
    rewards: { money: 6000, xp: 500, items: [{ id: 'bandage', n: 2 }, { id: 'a9_fmj', n: 30 }] },
  },
  {
    id: 'q_scav1', title: 'Ungeziefer', giver: 'brandt', level: 1, prereq: ['q_intro'],
    desc: 'Plünderer machen die Straßen unsicher. Dünne sie aus.',
    objectives: [{ type: 'kill', target: 'scav', count: 5, text: 'Eliminiere 5 Plünderer' }],
    rewards: { money: 9000, xp: 900, items: [{ id: 'vest_police', n: 1 }] },
  },
  {
    id: 'q_search1', title: 'Schatzsucher', giver: 'kowalski', level: 2,
    desc: 'Die Stadt ist voller vergessener Schätze. Durchwühle sie.',
    objectives: [{ type: 'search', count: 12, text: 'Durchsuche 12 Behälter' }],
    rewards: { money: 10000, xp: 800, items: [{ id: 'bp_tac', n: 1 }] },
  },
  {
    id: 'q_med1', title: 'Medizinischer Nachschub', giver: 'weiss', level: 2,
    desc: 'Mein Lazarett geht leer aus. Bring mir Vorräte aus den Apotheken und Badezimmern.',
    objectives: [{ type: 'handover', item: 'medsupply', count: 2, text: 'Übergib 2× Medizinische Vorräte' }],
    rewards: { money: 12000, xp: 1000, items: [{ id: 'ifak', n: 1 }], unlock: 'IFAK bei Dr. Weiss kaufbar (LL2)' },
  },
  {
    id: 'q_intel1', title: 'Spurensuche', giver: 'brandt', level: 3, prereq: ['q_scav1'],
    desc: 'Irgendwo in den Büros liegen Dokumente über die Evakuierung. Ich will sie haben.',
    objectives: [{ type: 'handover', item: 'intel', count: 1, text: 'Übergib 1× Geheimdokumente' }],
    rewards: { money: 20000, xp: 1500, items: [{ id: 'helm_ssh', n: 1 }] },
  },
  {
    id: 'q_radio', title: 'Funkstille', giver: 'brandt', level: 3,
    desc: 'Der Funkturm im Osten von Grenzstadt sendet nicht mehr. Sieh nach und komm heil zurück.',
    objectives: [
      { type: 'visit', zone: 'funkturm', map: 'grenzstadt', text: 'Erkunde den Funkturm (Grenzstadt)' },
      { type: 'extract', count: 1, map: 'grenzstadt', text: 'Extrahiere aus Grenzstadt' },
    ],
    rewards: { money: 15000, xp: 1200, items: [{ id: 'frag', n: 2 }] },
  },
  {
    id: 'q_pmc1', title: 'Söldnerjagd', giver: 'brandt', level: 4, prereq: ['q_scav1'],
    desc: 'Eine Söldnertruppe räumt die besten Verstecke leer. Mach ihnen das Leben schwer.',
    objectives: [{ type: 'kill', target: 'pmc', count: 3, text: 'Eliminiere 3 Söldner' }],
    rewards: { money: 25000, xp: 2000, items: [{ id: 'a556_fmj', n: 60 }], unlock: 'M4A1 bei Major Brandt kaufbar (LL3)' },
  },
  {
    id: 'q_elec', title: 'Elektronik', giver: 'kowalski', level: 4,
    desc: 'Meine Kunden zahlen gut für Hardware. Festplatten, Prozessoren – alles.',
    objectives: [
      { type: 'handover', item: 'hdd', count: 2, text: 'Übergib 2× Festplatte' },
      { type: 'handover', item: 'cpu', count: 1, text: 'Übergib 1× Prozessor' },
    ],
    rewards: { money: 25000, xp: 1600 },
  },
  {
    id: 'q_pharm', title: 'Hausapotheke', giver: 'weiss', level: 4,
    desc: 'Durchsuche Medizinschränke in Grenzstadt – ich brauche einen Überblick über die Vorräte.',
    objectives: [{ type: 'search', count: 4, kind: ['medcase'], map: 'grenzstadt', text: 'Durchsuche 4 Medizinschränke in Grenzstadt' }],
    rewards: { money: 15000, xp: 1200, items: [{ id: 'stim', n: 1 }] },
  },
  {
    id: 'q_hafen1', title: 'Hafenratten', giver: 'brandt', level: 5,
    desc: 'Der Industriehafen ist ein Nest. Räum auf.',
    objectives: [{ type: 'kill', target: 'scav', count: 8, map: 'hafen', text: 'Eliminiere 8 Plünderer im Industriehafen' }],
    rewards: { money: 30000, xp: 2500 },
  },
  {
    id: 'q_doc2', title: 'Lebensretter', giver: 'weiss', level: 5, prereq: ['q_med1'],
    desc: 'Ein funktionierender Defibrillator würde Leben retten.',
    objectives: [{ type: 'handover', item: 'defib', count: 1, text: 'Übergib 1× Defibrillator' }],
    rewards: { money: 40000, xp: 2500, items: [{ id: 'surgkit', n: 1 }] },
  },
  {
    id: 'q_heli', title: 'Heißer Draht', giver: 'kowalski', level: 6,
    desc: 'Mein Pilot braucht Kundschaft. Ruf den Heli und steig ein.',
    objectives: [{ type: 'extract', count: 1, extract: 'heli', text: 'Extrahiere per Helikopter' }],
    rewards: { money: 35000, xp: 2500, items: [{ id: 'selfrevive', n: 1 }] },
  },
  {
    id: 'q_sniper', title: 'Scharfschütze', giver: 'brandt', level: 6,
    desc: 'Zeig mir, dass du mit einem Zielfernrohr umgehen kannst.',
    objectives: [{ type: 'kill', target: 'any', count: 5, wclass: ['dmr', 'sniper'], text: 'Eliminiere 5 Gegner mit Präzisions-/Scharfschützengewehr' }],
    rewards: { money: 30000, xp: 2200, items: [{ id: 'a308_fmj', n: 40 }] },
  },
  {
    id: 'q_head', title: 'Kopfsache', giver: 'brandt', level: 7,
    desc: 'Effizienz. Ein Schuss, ein Treffer – in den Kopf.',
    objectives: [{ type: 'kill', target: 'any', count: 10, head: true, text: 'Eliminiere 10 Gegner per Kopfschuss' }],
    rewards: { money: 35000, xp: 2500 },
  },
  {
    id: 'q_boss1', title: 'Kopf der Schlange', giver: 'brandt', level: 8, prereq: ['q_pmc1'],
    desc: 'Der Kommandant hat sich in der Militärbasis von Grenzstadt verschanzt. Beende seine Herrschaft.',
    objectives: [{ type: 'kill', target: 'boss', count: 1, map: 'grenzstadt', text: 'Eliminiere den Kommandanten' }],
    rewards: { money: 80000, xp: 5000, items: [{ id: 'vest_plate', n: 1 }], unlock: 'M249 bei Major Brandt kaufbar (LL4)' },
  },
  {
    id: 'q_gold', title: 'Goldrausch', giver: 'kowalski', level: 9,
    desc: 'Gold behält seinen Wert. Auch in der Zone.',
    objectives: [
      { type: 'handover', item: 'chain', count: 2, text: 'Übergib 2× Goldkette' },
      { type: 'handover', item: 'watch', count: 1, text: 'Übergib 1× Luxusuhr' },
    ],
    rewards: { money: 45000, xp: 3000 },
  },
  {
    id: 'q_ship', title: 'Der Frachter', giver: 'brandt', level: 10,
    desc: 'Auf dem Frachter im Hafen läuft etwas Großes. Geh an Bord und komm zurück.',
    objectives: [
      { type: 'visit', zone: 'schiff', map: 'hafen', text: 'Betritt den Frachter (Industriehafen)' },
      { type: 'extract', count: 1, map: 'hafen', text: 'Extrahiere aus dem Industriehafen' },
    ],
    rewards: { money: 40000, xp: 3000 },
  },
  {
    id: 'q_pmc2', title: 'Aufräumarbeiten', giver: 'brandt', level: 10, prereq: ['q_pmc1'],
    desc: 'Die Söldner kommen immer wieder. Diesmal endgültig.',
    objectives: [{ type: 'kill', target: 'pmc', count: 15, text: 'Eliminiere 15 Söldner' }],
    rewards: { money: 90000, xp: 5000 },
  },
  {
    id: 'q_boss2', title: 'Kapitän Volkov', giver: 'brandt', level: 12, prereq: ['q_boss1'],
    desc: 'Volkov kontrolliert den Schmuggel über den Hafen. Schalte ihn aus.',
    objectives: [{ type: 'kill', target: 'boss', count: 1, map: 'hafen', text: 'Eliminiere Kapitän Volkov' }],
    rewards: { money: 120000, xp: 7000, items: [{ id: 'helm_altyn', n: 1 }] },
  },
  {
    id: 'q_vet', title: 'Veteran', giver: 'kowalski', level: 14,
    desc: 'Nur wer immer wieder zurückkommt, wird reich.',
    objectives: [{ type: 'extract', count: 25, text: 'Extrahiere 25-mal' }],
    rewards: { money: 150000, xp: 8000, items: [{ id: 'bp_expedition', n: 1 }] },
  },
];

export function questDef(id: string) {
  return QUESTS.find((q) => q.id === id);
}

/** Fortschritt aller Ziele aus einem Raid-Ergebnis ableiten (ohne Übergaben). */
export function objectiveGain(o: Objective, r: RaidResult): number {
  switch (o.type) {
    case 'kill': {
      if (o.map && o.map !== r.mapId) return 0;
      return r.stats.killLog.filter(
        (k) => (o.target === 'any' || k.type === o.target) && (!o.wclass || o.wclass.includes(k.wclass as WeaponClass)) && (!o.head || k.head),
      ).length;
    }
    case 'extract':
      if (r.status !== 'extracted') return 0;
      if (o.map && o.map !== r.mapId) return 0;
      if (o.extract && r.extractId !== o.extract) return 0;
      return 1;
    case 'search': {
      if (o.map && o.map !== r.mapId) return 0;
      let n = 0;
      for (const [k, v] of Object.entries(r.stats.searched)) if (!o.kind || o.kind.includes(k as ContainerKind)) n += v ?? 0;
      return n;
    }
    case 'visit':
      return o.map === r.mapId && r.stats.visited.includes(o.zone) ? 1 : 0;
    case 'handover':
      return 0;
  }
}

export function objectiveTarget(o: Objective): number {
  return o.type === 'visit' ? 1 : o.count;
}
