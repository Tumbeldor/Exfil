import { TILE } from '../../shared/constants';
import { ammoDef, hasItemDef, weaponDef } from '../../shared/items';
import { formatTime } from '../../shared/math';
import type { ExtractDef } from '../../shared/map/GameMap';
import type { ExtractSnap, MeSnap } from '../../shared/sim/types';
import { h } from '../ui/dom';
import type { ViewState } from './ViewState';

export interface HudData {
  me: MeSnap | null;
  x: number;
  y: number;
  aim: number;
  weapon: string | null;
  mag: number;
  reserve: number;
  timeLeft: number;
  prompt: string | null;
  view: ViewState;
  meId: number;
  touch: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  heal: 'Behandlung',
  revive: 'Wiederbeleben',
  search: 'Durchsuchen',
  unlock: 'Aufschließen',
  radio: 'Funkspruch',
  selfrevive: 'Selbstwiederbelebung',
};

export class Hud {
  root: HTMLElement;
  private timer: HTMLElement;
  private mapName: HTMLElement;
  private hpBar: HTMLElement;
  private hpFill: HTMLElement;
  private hpText: HTMLElement;
  private stFill: HTMLElement;
  private status: HTMLElement;
  private squad: HTMLElement;
  private exList: HTMLElement;
  private minimap: HTMLCanvasElement;
  private killfeed: HTMLElement;
  private msgs: HTMLElement;
  private progress: HTMLElement;
  private progLabel: HTMLElement;
  private progFill: HTMLElement;
  private wName: HTMLElement;
  private wAmmo: HTMLElement;
  private wType: HTMLElement;
  private prompt: HTMLElement;
  private vignette: HTMLElement;
  private showEx = false;
  private last: Record<string, string> = {};
  private mmT = 0;
  onMapClick?: () => void;
  private overview: HTMLCanvasElement | null = null;

  constructor(parent: HTMLElement, mapName: string, private extractDefs: ExtractDef[]) {
    this.timer = h('div', { class: 'timer', onclick: () => this.toggleExtracts() }, '00:00');
    this.mapName = h('div', { class: 'tiny muted' }, mapName.toUpperCase() + ' · Extraktionen: O');
    this.hpFill = h('div');
    this.hpText = h('span', null, '100');
    this.hpBar = h('div', { class: 'hbar hp' }, this.hpFill, this.hpText);
    this.stFill = h('div');
    this.status = h('div', { class: 'status-icons' });
    this.squad = h('div', { class: 'squad' });
    this.exList = h('div', { class: 'extract-list hidden' });
    this.minimap = h('canvas', { class: 'minimap', width: 300, height: 300, onclick: () => this.onMapClick?.() });
    this.killfeed = h('div', { class: 'killfeed' });
    this.msgs = h('div', { class: 'msgs' });
    this.progLabel = h('div');
    this.progFill = h('div');
    this.progress = h('div', { class: 'progress hidden' }, this.progLabel, h('div', { class: 'hbar' }, this.progFill));
    this.wName = h('div', { class: 'wn' });
    this.wAmmo = h('div', { class: 'ammo' });
    this.wType = h('div', { class: 'at' });
    this.prompt = h('div', { class: 'prompt hidden' });
    this.vignette = h('div', { class: 'vignette' });
    this.root = h(
      'div',
      { class: 'hud' },
      this.vignette,
      h('div', { class: 'tl' }, this.timer, this.mapName, this.hpBar, h('div', { class: 'hbar st' }, this.stFill), this.status, this.squad, this.exList),
      h('div', { class: 'tr' }, this.minimap, this.killfeed),
      h('div', { class: 'center-top' }, this.progress, this.msgs),
      h('div', { class: 'weapon' }, this.wName, this.wAmmo, this.wType),
      this.prompt,
    );
    parent.appendChild(this.root);
  }

  setTouch(touch: boolean) {
    const tr = this.root.querySelector('.tr') as HTMLElement;
    tr.style.top = touch ? 'calc(60px + var(--sat))' : '';
  }

  toggleExtracts() {
    this.showEx = !this.showEx;
    this.exList.classList.toggle('hidden', !this.showEx);
  }

  private set(key: string, el: HTMLElement, text: string) {
    if (this.last[key] === text) return;
    this.last[key] = text;
    el.textContent = text;
  }

  message(text: string, kind = 'info', ms = 4000) {
    const m = h('div', { class: 'msg ' + kind }, text);
    this.msgs.appendChild(m);
    while (this.msgs.children.length > 5) this.msgs.firstChild?.remove();
    setTimeout(() => m.remove(), ms);
  }

  kill(killer: string, victim: string, weapon: string, mine: boolean, head: boolean) {
    const e = h('div', { class: 'kf' + (mine ? ' me' : '') }, killer, h('span', { class: 'w' }, `[${weapon}${head ? ' ⌖' : ''}]`), victim);
    this.killfeed.appendChild(e);
    while (this.killfeed.children.length > 5) this.killfeed.firstChild?.remove();
    setTimeout(() => e.remove(), 7000);
  }

  damageFlash(strength: number) {
    this.vignette.style.boxShadow = `inset 0 0 ${120 + strength * 80}px rgba(200,20,20,${Math.min(0.75, 0.25 + strength * 0.5)})`;
    setTimeout(() => this.update_vignette(), 180);
  }
  private lowHp = false;
  private update_vignette() {
    this.vignette.style.boxShadow = this.lowHp ? 'inset 0 0 140px rgba(200,20,20,0.35)' : 'inset 0 0 160px rgba(200,20,20,0)';
  }

  update(d: HudData) {
    const me = d.me;
    this.set('timer', this.timer, formatTime(d.timeLeft));
    this.timer.classList.toggle('low', d.timeLeft < 120);
    if (me) {
      const frac = Math.max(0, me.hp / me.mhp);
      this.hpFill.style.width = frac * 100 + '%';
      this.hpBar.classList.toggle('low', frac < 0.35);
      this.set('hp', this.hpText, `${Math.ceil(me.hp)} HP`);
      this.stFill.style.width = me.st + '%';
      const low = frac < 0.3;
      if (low !== this.lowHp) {
        this.lowHp = low;
        this.update_vignette();
      }
      const st: string[] = [];
      if (me.bl) st.push('<span class="st bleed">BLUTUNG</span>');
      if (me.stim > 0) st.push(`<span class="st stim">ADRENALIN ${Math.ceil(me.stim)}s</span>`);
      if (me.dn) st.push('<span class="st bleed">AM BODEN</span>');
      const html = st.join('');
      if (this.last.status !== html) {
        this.last.status = html;
        this.status.innerHTML = html;
      }
      // Fortschritt
      let label = '';
      let frac2 = 0;
      let cls = 'progress';
      if (me.dn) {
        label = me.act?.type === 'selfrevive' ? 'Selbstwiederbelebung …' : `Am Boden – verblutet in ${Math.ceil(me.dt)} s`;
        frac2 = me.act ? me.act.t / me.act.total : me.dt / 40;
        cls += ' downed';
      } else if (me.act) {
        label = ACTION_LABEL[me.act.type] ?? 'Aktion';
        frac2 = me.act.t / me.act.total;
      } else if (me.ex) {
        const def = this.extractDefs.find((e) => e.id === me.ex!.id);
        const need = def?.kind === 'heli' ? 4 : 8;
        if (me.ex.need) {
          label = `${def?.name ?? 'Extraktion'}: ${me.ex.need}`;
          frac2 = 0;
        } else {
          label = `Extraktion ${def?.name ?? ''} in ${Math.max(0, need - me.ex.t).toFixed(1)} s`;
          frac2 = me.ex.t / need;
        }
        cls += ' extract';
      } else if (me.rl > 0) {
        label = 'Nachladen …';
        frac2 = 1 - me.rl / Math.max(0.01, me.rlt);
      }
      this.progress.className = label ? cls : 'progress hidden';
      if (label) {
        this.set('prog', this.progLabel, label);
        this.progFill.style.width = Math.min(100, frac2 * 100) + '%';
      }
    }
    // Waffe
    if (d.weapon && hasItemDef(d.weapon)) {
      const wd = weaponDef(d.weapon);
      this.set('wn', this.wName, wd.short);
      const ammoHtml = `${d.mag}<small> / ${wd.mag} · ${d.reserve}</small>`;
      if (this.last.ammo !== ammoHtml) {
        this.last.ammo = ammoHtml;
        this.wAmmo.innerHTML = ammoHtml;
      }
      this.wAmmo.classList.toggle('empty', d.mag === 0);
      this.set('at', this.wType, me?.ammo && hasItemDef(me.ammo) ? ammoDef(me.ammo).short + (wd.auto ? ' · AUTO' : ' · EINZEL') : '');
    } else {
      this.set('wn', this.wName, 'Keine Waffe');
      this.wAmmo.innerHTML = '';
      this.last.ammo = '';
    }
    // Hinweis
    if (d.prompt && !d.touch) {
      const html = `<kbd>E</kbd>${d.prompt}`;
      if (this.last.prompt !== html) {
        this.last.prompt = html;
        this.prompt.innerHTML = html;
      }
      this.prompt.classList.remove('hidden');
    } else this.prompt.classList.add('hidden');
    // Squad
    const mates = d.view.info.squad.filter((s) => s.id !== d.meId);
    if (mates.length) {
      const parts: string[] = [];
      for (const s of mates) {
        const a = d.view.actors.get(s.id);
        const hp = a ? (a.hp ?? 100) : 0;
        const state = !a ? 'raus' : a.f & 16 ? 'am Boden' : '';
        parts.push(`<div class="mate"><span class="dot" style="background:${s.color}"></span><span>${escapeHtml(s.name)}</span><div class="hbar"><div style="width:${hp}%;background:${hp < 35 ? 'var(--bad)' : 'var(--good)'}"></div></div><span class="tiny muted">${state}</span></div>`);
      }
      const html = parts.join('');
      if (this.last.squad !== html) {
        this.last.squad = html;
        this.squad.innerHTML = html;
      }
    }
    // Extraktionsliste
    if (this.showEx) {
      const rows = this.extractDefs.map((def) => {
        const st = d.view.extractState(def.id);
        const dist = Math.round(Math.hypot(def.x - d.x, def.y - d.y) / TILE);
        return `<div class="ex"><span>${escapeHtml(def.name)}</span><span class="s ${exClass(def, st)}">${exText(def, st)} · ${dist} m</span></div>`;
      });
      const html = '<b class="accent">EXTRAKTIONEN</b>' + rows.join('');
      if (this.last.ex !== html) {
        this.last.ex = html;
        this.exList.innerHTML = html;
      }
    }
    // Minimap (gedrosselt)
    this.mmT -= 1;
    if (this.mmT <= 0) {
      this.mmT = 4;
      this.drawMinimap(d);
    }
  }

  setOverview(c: HTMLCanvasElement) {
    this.overview = c;
  }

  setMinimapVisible(v: boolean) {
    this.minimap.style.display = v ? '' : 'none';
  }

  private drawMinimap(d: HudData) {
    const ov = this.overview;
    if (!ov || this.minimap.style.display === 'none') return;
    const g = this.minimap.getContext('2d')!;
    const S = ov.width / d.view.map.w;
    const W = this.minimap.width;
    const range = 34;
    const scale = W / (range * 2 * S);
    const cx = (d.x / TILE) * S;
    const cy = (d.y / TILE) * S;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, W);
    g.imageSmoothingEnabled = false;
    g.setTransform(scale, 0, 0, scale, W / 2 - cx * scale, W / 2 - cy * scale);
    g.drawImage(ov, 0, 0);
    const toM = (x: number) => (x / TILE) * S;
    for (const def of this.extractDefs) {
      const st = d.view.extractState(def.id);
      g.fillStyle = st?.open ? '#7cf06a' : '#e0b060';
      g.beginPath();
      g.arc(toM(def.x), toM(def.y), 3.5, 0, Math.PI * 2);
      g.fill();
    }
    for (const a of d.view.actors.values()) {
      if (a.k !== 'p' || a.i === d.meId) continue;
      g.fillStyle = a.c ?? '#fff';
      g.beginPath();
      g.arc(toM(a.x), toM(a.y), 3, 0, Math.PI * 2);
      g.fill();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(W / 2, W / 2, 6, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(W / 2, W / 2);
    g.lineTo(W / 2 + Math.cos(d.aim) * 22, W / 2 + Math.sin(d.aim) * 22);
    g.stroke();
  }

  destroy() {
    this.root.remove();
  }
}

export function exText(def: ExtractDef, st: ExtractSnap | undefined): string {
  if (!st) return '?';
  if (def.kind === 'heli') {
    const p = st.heli?.phase;
    return p === 'landed' ? `GELANDET ${st.heli?.t ?? ''}s` : p === 'inbound' ? `im Anflug ${st.heli?.t ?? ''}s` : p === 'cooldown' ? 'abgeflogen' : 'Funk rufen';
  }
  if (!st.open) return def.kind === 'timed' ? 'geschlossen (zeitgesteuert)' : 'nicht verfügbar';
  if (def.kind === 'paid') return `offen (${(def.cost ?? 0).toLocaleString('de-DE')} €)`;
  if (def.kind === 'key') return 'offen (Schlüssel)';
  return 'offen';
}
export function exClass(def: ExtractDef, st: ExtractSnap | undefined): string {
  if (!st) return 'muted';
  if (def.kind === 'heli') return st.heli?.phase === 'landed' ? 'good' : 'warn';
  return st.open ? (def.kind === 'open' || def.kind === 'chance' || def.kind === 'timed' ? 'good' : 'warn') : 'bad';
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
