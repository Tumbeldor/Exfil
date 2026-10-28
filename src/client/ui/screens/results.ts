import { formatMoney, formatTime } from '../../../shared/math';
import { mapMeta } from '../../../shared/map/maps';
import type { RaidReport } from '../../../shared/profile';
import { levelProgress } from '../../../shared/progression';
import type { RaidResult } from '../../../shared/sim/types';
import type { App } from '../App';
import { h } from '../dom';
import { itemTile } from '../itemUi';

export function resultsScreen(app: App, rep: RaidReport, r: RaidResult, coop: boolean): HTMLElement {
  const title = r.status === 'extracted' ? 'Extrahiert' : r.status === 'killed' ? 'Gefallen' : 'Vermisst';
  const sub =
    r.status === 'extracted'
      ? `Über ${r.extractName ?? 'Extraktion'} entkommen.`
      : r.status === 'killed'
        ? `Getötet von ${r.killedBy ?? 'Unbekannt'}. Deine Ausrüstung ist verloren.`
        : 'Die Zeit ist abgelaufen. Deine Ausrüstung ist verloren.';
  const s = r.stats;
  const kills = s.kills.scav + s.kills.pmc + s.kills.guard + s.kills.boss;
  const searched = Object.values(s.searched).reduce((a, b) => (a ?? 0) + (b ?? 0), 0) ?? 0;
  const kv = (rows: [string, string][]) => {
    const g = h('div', { class: 'kv' });
    for (const [k, v] of rows) g.append(h('div', { class: 'muted' }, k), h('div', { class: 'v' }, v));
    return g;
  };
  const lp = levelProgress(app.profile.xp);
  const items = [...Object.values(r.inventory.equip), ...r.inventory.bag, ...r.inventory.secure].filter(Boolean);
  return h(
    'div',
    { class: 'screen results' },
    h('div', { class: 'result-banner ' + r.status }, title),
    h('div', { class: 'muted center', style: { marginBottom: '12px' } }, `${mapMeta(r.mapId).name} · ${formatTime(r.time)} · ${sub}`),
    rep.levelAfter > rep.levelBefore ? h('div', { class: 'panel center', style: { padding: '10px 18px', marginBottom: '10px', borderColor: 'var(--accent)' } }, h('b', { class: 'accent' }, `LEVEL ${rep.levelAfter} ERREICHT!`), h('div', { class: 'tiny muted' }, 'Neue Händlerangebote und Aufträge könnten verfügbar sein.')) : null,
    h(
      'div',
      { class: 'row gap wrap', style: { alignItems: 'flex-start', justifyContent: 'center', width: 'min(900px,100%)' } },
      h(
        'div',
        { class: 'panel col gap-s', style: { padding: '14px', flex: '1', minWidth: '260px' } },
        h('h2', null, 'Erfahrung'),
        kv([
          ['Abschüsse', `+${r.xp.kills}`],
          ['Durchsuchen', `+${r.xp.search}`],
          ['Extraktion', `+${r.xp.extract}`],
          ['Überlebenszeit', `+${r.xp.survival}`],
          ['Gesamt', `+${r.xp.total} XP`],
        ]),
        h('div', { class: 'xpbar', style: { marginTop: '6px' } }, h('div', { style: { width: lp.frac * 100 + '%' } })),
        h('div', { class: 'tiny muted' }, `Level ${lp.level} · ${lp.cur.toLocaleString('de-DE')} / ${lp.need.toLocaleString('de-DE')} XP`),
      ),
      h(
        'div',
        { class: 'panel col gap-s', style: { padding: '14px', flex: '1', minWidth: '260px' } },
        h('h2', null, 'Statistik'),
        kv([
          ['Eliminierungen', `${kills} (P ${s.kills.scav} · S ${s.kills.pmc} · W ${s.kills.guard} · B ${s.kills.boss})`],
          ['Schaden verursacht', String(Math.round(s.damage))],
          ['Treffer / Schüsse', `${s.hits} / ${s.shots}`],
          ['Behälter durchsucht', String(searched)],
          ['Leichen geplündert', String(s.bodies)],
          ['Bargeld gutgeschrieben', formatMoney(rep.cash)],
          [r.status === 'extracted' ? 'Mitgebrachter Wert' : 'Verlorene Ausrüstung', formatMoney(r.status === 'extracted' ? rep.lootValue : rep.kitLost)],
        ]),
      ),
    ),
    rep.quests.length
      ? h(
          'div',
          { class: 'panel col gap-s', style: { padding: '14px', marginTop: '10px', width: 'min(900px,100%)' } },
          h('h2', null, 'Auftragsfortschritt'),
          rep.quests.map((q) => h('div', { class: 'small' + (q.to >= q.target ? ' good' : '') }, `${q.quest}: ${q.text} – ${q.to}/${q.target}`)),
        )
      : null,
    items.length
      ? h(
          'div',
          { class: 'panel col gap-s', style: { padding: '14px', marginTop: '10px', width: 'min(900px,100%)' } },
          h('h2', null, r.status === 'extracted' ? 'Mitgebracht' : 'Gerettet (sicherer Behälter)'),
          h('div', { class: 'item-grid' }, items.map((it) => itemTile(it))),
        )
      : null,
    h(
      'div',
      { class: 'row gap', style: { margin: '16px 0 24px' } },
      h('button', { class: 'btn primary big', onclick: () => app.goHideout() }, 'Zum Versteck'),
      coop && app.net?.lobby ? h('button', { class: 'btn big', onclick: () => app.goLobby() }, 'Zur Lobby') : null,
    ),
  );
}
