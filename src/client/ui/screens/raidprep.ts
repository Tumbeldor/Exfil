import { inventoryValue } from '../../../shared/inventory';
import { MAP_METAS } from '../../../shared/map/maps';
import { formatMoney, formatTime } from '../../../shared/math';
import { kitWarnings, profileLevel } from '../../../shared/profile';
import type { App } from '../App';
import { clear, confirmDialog, h } from '../dom';
import { itemTile } from '../itemUi';

export const DIFFICULTIES = ['Leicht', 'Normal', 'Schwer'];

export function mapCards(app: App, selected: string, onSelect: (id: string) => void, enforceLevel = true): HTMLElement {
  const lvl = profileLevel(app.profile);
  return h(
    'div',
    { class: 'map-cards' },
    MAP_METAS.map((m) => {
      const locked = enforceLevel && lvl < m.minLevel;
      const cv = h('canvas', { width: 150 * 2, height: 110 * 2 }) as HTMLCanvasElement;
      const g = cv.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      g.drawImage(app.overview(m.id), 0, 0, cv.width, cv.height);
      return h(
        'div',
        {
          class: 'map-card' + (m.id === selected ? ' sel' : '') + (locked ? ' locked' : ''),
          onclick: () => {
            if (!locked) onSelect(m.id);
          },
        },
        cv,
        h(
          'div',
          { class: 'mc-body' },
          h('div', { class: 'row gap-s' }, h('b', null, m.name), h('span', { class: 'll' }, formatTime(m.raidTime)), locked ? h('span', { class: 'll', style: { color: 'var(--bad)' } }, `ab Level ${m.minLevel}`) : null),
          h('div', { class: 'tiny muted', style: { marginTop: '4px' } }, m.desc),
        ),
      );
    }),
  );
}

export function raidPrepScreen(app: App): HTMLElement {
  const root = h('div', { class: 'screen' });
  let mapId = 'grenzstadt';
  let diff = app.settings.difficulty;
  const render = () => {
    clear(root);
    const p = app.profile;
    root.appendChild(
      h(
        'div',
        { class: 'topbar' },
        h('button', { class: 'btn small', onclick: () => app.goMenu() }, '← Menü'),
        h('h2', null, 'Solo-Raid'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn small', onclick: () => app.goHideout() }, 'Ausrüstung ändern'),
      ),
    );
    const kit = p.char;
    const tiles = h('div', { class: 'item-grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(56px,1fr))' } });
    for (const s of ['primary', 'secondary', 'helmet', 'armor', 'backpack'] as const) if (kit.equip[s]) tiles.appendChild(itemTile(kit.equip[s]!));
    for (const it of kit.bag) tiles.appendChild(itemTile(it));
    const warns = kitWarnings(p);
    const body = h(
      'div',
      { class: 'split scroll', style: { flex: '1' } },
      h('div', { class: 'pane', style: { flex: '1.4' } }, h('h3', null, 'Zone wählen'), mapCards(app, mapId, (id) => ((mapId = id), render()))),
      h(
        'div',
        { class: 'pane', style: { flex: '1' } },
        h('h3', null, 'Schwierigkeit'),
        h(
          'div',
          { class: 'filter-chips' },
          DIFFICULTIES.map((d, i) =>
            h(
              'div',
              {
                class: 'chip' + (diff === i ? ' active' : ''),
                onclick: () => {
                  diff = i;
                  app.settings.difficulty = i;
                  app.saveSettings();
                  render();
                },
              },
              d,
            ),
          ),
        ),
        h('div', { class: 'tiny muted' }, ['Weniger Gegner, langsamere Reaktionen.', 'Ausgewogen.', 'Mehr Gegner, schnellere und präzisere Bots.'][diff]),
        h('h3', { style: { marginTop: '10px' } }, `Deine Ausrüstung · ${formatMoney(inventoryValue(kit))}`),
        tiles,
        warns.length ? h('div', { class: 'col gap-s' }, warns.map((w) => h('div', { class: 'small warn' }, '⚠ ' + w))) : h('div', { class: 'small good' }, '✓ Einsatzbereit'),
        h('div', { class: 'tiny muted' }, 'Bei Tod verlierst du alles außer dem sicheren Behälter. Bargeld wird bei Extraktion gutgeschrieben.'),
        h(
          'button',
          {
            class: 'btn primary big',
            style: { marginTop: '10px' },
            onclick: async () => {
              if (warns.some((w) => w.startsWith('Keine Waffe')) && !(await confirmDialog('Ohne Waffe in die Zone?', 'Trotzdem starten'))) return;
              app.startSolo(mapId, diff);
            },
          },
          'Zone betreten',
        ),
      ),
    );
    root.appendChild(body);
  };
  render();
  return root;
}
