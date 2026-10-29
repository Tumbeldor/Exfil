import { formatMoney } from '../../../shared/math';
import { levelProgress } from '../../../shared/progression';
import { QUESTS } from '../../../shared/quests';
import { questStatus } from '../../../shared/profile';
import type { App } from '../App';
import { h, modal } from '../dom';

export function profileChip(app: App): HTMLElement {
  const p = app.profile;
  const lp = levelProgress(p.xp);
  return h(
    'div',
    { class: 'panel profile-chip' },
    h('div', { class: 'level-badge' }, String(lp.level)),
    h(
      'div',
      { class: 'col gap-s' },
      h('div', { style: { fontWeight: '800' } }, p.name),
      h('div', { class: 'xpbar' }, h('div', { style: { width: lp.frac * 100 + '%' } })),
      h('div', { class: 'tiny muted' }, lp.need ? `${lp.cur.toLocaleString('de-DE')} / ${lp.need.toLocaleString('de-DE')} XP` : 'Maximales Level'),
    ),
    h('div', { class: 'col', style: { marginLeft: '12px', alignItems: 'flex-end' } }, h('div', { class: 'mono accent', style: { fontWeight: '800' } }, formatMoney(p.money)), h('div', { class: 'tiny muted' }, `${p.stats.extracts}/${p.stats.raids} Raids überlebt`)),
  );
}

export function menuScreen(app: App): HTMLElement {
  const claimable = QUESTS.filter((q) => questStatus(app.profile, q) === 'complete').length;
  const standalone = (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone) ?? false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const help = () =>
    modal(
      h(
        'div',
        { style: { maxWidth: '520px' }, class: 'col gap' },
        h('h2', null, 'So funktioniert es'),
        h('p', null, 'Rüste dich im Versteck aus, betritt eine Zone, sammle Beute und erreiche eine Extraktion, bevor die Zeit abläuft. Stirbst du, ist alles verloren, was du dabei hattest – nur der sichere Behälter bleibt.'),
        h('h3', null, 'PC'),
        h('p', { class: 'small' }, 'WASD bewegen · Shift sprinten · Maus zielen, Linksklick feuern, Rechtsklick genau zielen · R nachladen · Q/Mausrad/1/2 Waffe wechseln · E interagieren · Tab Inventar · H heilen · 4 Verband · 6 Adrenalin · G Granate · Z/Mittlere Maustaste markieren · M Karte · O Extraktionen · Esc Menü'),
        h('h3', null, 'iPhone / Touch'),
        h('p', { class: 'small' }, 'Bitte im Querformat spielen. Linker Daumen: Bewegungsstick (über den Rand ziehen = sprinten). Rechter Daumen: Zielstick – weit ausgelenkt wird gefeuert. Buttons für Nachladen, Zielfernrohr, Heilen, Granate, Waffenwechsel, Inventar, Karte und Markierung. Für Vollbild: in Safari „Teilen → Zum Home-Bildschirm“.'),
        h('h3', null, 'Gamepad'),
        h('p', { class: 'small' }, 'Linker Stick bewegen, rechter Stick zielen, RT feuern, LT zielen, A interagieren, X nachladen, Y Waffe wechseln, B heilen, RB Granate, Steuerkreuz ↑ Inventar.'),
        h('h3', null, 'Extraktionen'),
        h('p', { class: 'small' }, 'Offen: immer verfügbar. Zufall: nicht in jedem Raid offen. Zeitgesteuert: öffnet später. Bezahlt: braucht Bargeld im Inventar. Schlüssel: braucht den passenden Schlüssel. Heli: per Funk rufen, landen lassen, einsteigen – lockt aber Gegner an.'),
      ),
    );
  return h(
    'div',
    { class: 'screen menu-screen' },
    h('div', { class: 'title' }, h('div', { class: 't1' }, 'EXTRACTION'), h('div', { class: 't1 t1b' }, 'LOOTER'), h('div', { class: 't2' }, 'Sperrzone · Top-Down Extraction Shooter')),
    h(
      'div',
      { class: 'menu-buttons' },
      h('button', { class: 'btn primary', onclick: () => app.goRaidPrep() }, h('span', null, 'Solo-Raid', h('span', { class: 'sub' }, 'Allein gegen die Zone'))),
      h('button', { class: 'btn', onclick: () => app.goLobby() }, h('span', null, 'Coop', h('span', { class: 'sub' }, 'Mit Freunden (bis 4)'))),
      h('button', { class: 'btn', onclick: () => app.goHideout() }, h('span', null, 'Versteck', h('span', { class: 'sub' }, claimable ? `${claimable} Auftrag abholbar!` : 'Lager · Händler · Aufträge'))),
      h('button', { class: 'btn', onclick: () => app.goSettings() }, h('span', null, 'Einstellungen', h('span', { class: 'sub' }, 'Steuerung · Grafik · Ton'))),
    ),
    profileChip(app),
    h('div', { class: 'row gap menu-help' }, h('button', { class: 'btn small', onclick: help }, 'Anleitung'), ios && !standalone ? h('span', { class: 'tiny muted' }, 'Tipp: Teilen → „Zum Home-Bildschirm“ für Vollbild') : null),
    h('div', { class: 'tiny muted orient-hint' }, '📱 Am Handy bitte alles im Querformat spielen – Gerät quer halten.'),
  );
}
