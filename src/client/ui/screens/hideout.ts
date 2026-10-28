import { EQUIP_SLOTS, SLOT_NAMES, bagCapacity, inventoryValue, inventoryWeight, slotsUsed, slotForDef } from '../../../shared/inventory';
import { type ItemCat, type ItemStack, isArmor, isWeapon, itemDef, stackValue } from '../../../shared/items';
import { formatMoney, formatTime } from '../../../shared/math';
import {
  type Where,
  PLAYER_COLORS,
  buyOffer,
  buyUpgrade,
  claimFreeKit,
  claimQuest,
  countOwned,
  exportProfile,
  handover,
  hasAnyWeapon,
  importProfile,
  kitWarnings,
  loadWeapon,
  locate,
  loyalty,
  moveItem,
  newProfile,
  offerUnlocked,
  profileLevel,
  questAvailable,
  questStatus,
  repairItem,
  sellBonus,
  sellItem,
  sellJunk,
  stashAll,
  unloadWeapon,
  vaultCap,
} from '../../../shared/profile';
import { LL_LEVELS, TRADERS, type TraderId, UPGRADES, levelProgress } from '../../../shared/progression';
import { QUESTS, objectiveTarget, questDef } from '../../../shared/quests';
import { OFFERS, repairCost, sellPrice } from '../../../shared/trader';
import { audio } from '../../game/Audio';
import type { App } from '../App';
import { clear, confirmDialog, h, modal, toast } from '../dom';
import { emptySlot, itemHeader, itemStats, itemTile } from '../itemUi';

export type HideoutTab = 'gear' | 'trader' | 'quests' | 'upgrades' | 'profile';

const FILTERS: { id: string; label: string; cats: ItemCat[] | null }[] = [
  { id: 'all', label: 'Alle', cats: null },
  { id: 'weapon', label: 'Waffen', cats: ['weapon'] },
  { id: 'ammo', label: 'Munition', cats: ['ammo', 'grenade'] },
  { id: 'gear', label: 'Ausrüstung', cats: ['armor', 'helmet', 'backpack'] },
  { id: 'med', label: 'Medizin', cats: ['med'] },
  { id: 'loot', label: 'Beute', cats: ['barter', 'valuable', 'cash'] },
  { id: 'key', label: 'Schlüssel', cats: ['key'] },
];

const CAT_ORDER: ItemCat[] = ['weapon', 'ammo', 'armor', 'helmet', 'backpack', 'med', 'grenade', 'key', 'valuable', 'barter', 'cash'];

export function hideoutScreen(app: App, initial: HideoutTab): HTMLElement {
  const root = h('div', { class: 'screen' });
  let tab = initial;
  let trader: TraderId = 'brandt';
  let traderMode: 'buy' | 'sell' | 'repair' = 'buy';
  let filter = 'all';
  const p = () => app.profile;
  const commit = (r: { ok: boolean; text?: string }, okSound: 'pickup' | 'good' = 'pickup') => {
    if (r.text) toast(r.text, r.ok ? 'good' : 'warn');
    if (r.ok) {
      app.save();
      audio.ui(okSound);
    } else audio.ui('bad');
    render();
  };

  const render = () => {
    const scrollers = [...root.querySelectorAll('.scroll')].map((e) => e.scrollTop);
    clear(root);
    const lp = levelProgress(p().xp);
    const claimable = QUESTS.filter((q) => questStatus(p(), q) === 'complete').length;
    root.appendChild(
      h(
        'div',
        { class: 'topbar' },
        h('button', { class: 'btn small', onclick: () => app.goMenu() }, '← Menü'),
        h('h2', null, 'Versteck'),
        h('div', { class: 'level-badge', style: { width: '34px', height: '34px', fontSize: '14px' }, title: `${lp.cur}/${lp.need} XP` }, String(lp.level)),
        h('span', { class: 'money' }, formatMoney(p().money)),
        h('div', { class: 'grow' }),
        app.net?.lobby
          ? h('button', { class: 'btn primary', onclick: () => app.goLobby() }, 'Zur Coop-Lobby ▶')
          : h('button', { class: 'btn primary', onclick: () => app.goRaidPrep() }, 'Raid starten ▶'),
      ),
    );
    const tabs: [HideoutTab, string, number][] = [
      ['gear', 'Ausrüstung & Lager', 0],
      ['trader', 'Händler', 0],
      ['quests', 'Aufträge', claimable],
      ['upgrades', 'Ausbau', 0],
      ['profile', 'Profil', 0],
    ];
    root.appendChild(
      h(
        'div',
        { class: 'tabs' },
        tabs.map(([id, label, badge]) =>
          h(
            'div',
            {
              class: 'tab' + (id === tab ? ' active' : ''),
              onclick: () => {
                tab = id;
                render();
              },
            },
            label,
            badge ? h('span', { class: 'badge' }, String(badge)) : null,
          ),
        ),
      ),
    );
    const body = h('div', { class: 'tab-body' });
    root.appendChild(body);
    if (tab === 'gear') body.appendChild(gearTab());
    if (tab === 'trader') body.appendChild(traderTab());
    if (tab === 'quests') body.appendChild(questsTab());
    if (tab === 'upgrades') body.appendChild(upgradesTab());
    if (tab === 'profile') body.appendChild(profileTab());
    const now = [...root.querySelectorAll('.scroll')];
    now.forEach((e, i) => (e.scrollTop = scrollers[i] ?? 0));
  };

  // ------------------------------------------------------------------
  const openItem = (uid: string) => {
    const loc = locate(p(), uid);
    if (!loc) return;
    const it = loc.item;
    const d = itemDef(it.id);
    let close = () => {};
    const qtyInput = d.stack > 1 && it.n > 1 ? (h('input', { type: 'number', min: '1', max: String(it.n), value: String(it.n), style: { width: '90px' } }) as HTMLInputElement) : null;
    const qty = () => (qtyInput ? Math.max(1, Math.min(it.n, Math.floor(Number(qtyInput.value) || it.n))) : undefined);
    const act = (label: string, fn: () => { ok: boolean; text?: string }, cls = 'btn small') =>
      h(
        'button',
        {
          class: cls,
          onclick: () => {
            close();
            commit(fn());
          },
        },
        label,
      );
    const actions: HTMLElement[] = [];
    const where = loc.where;
    const slot = slotForDef(d);
    if (slot && where !== 'equip') actions.push(act('Ausrüsten', () => moveItem(p(), uid, 'equip'), 'btn small primary'));
    if (where !== 'vault') actions.push(act('Ins Lager', () => moveItem(p(), uid, 'vault', qty())));
    if (where !== 'bag' && !(where === 'equip')) actions.push(act('In die Tasche', () => moveItem(p(), uid, 'bag', qty())));
    if (where === 'equip') actions.push(act('In die Tasche', () => moveItem(p(), uid, 'bag')));
    if (where !== 'secure' && d.size <= p().char.secureCap) actions.push(act('In sicheren Behälter', () => moveItem(p(), uid, 'secure', qty())));
    if (isWeapon(d)) {
      actions.push(act('Laden', () => loadWeapon(p(), uid)));
      if (it.mag) actions.push(act('Entladen', () => unloadWeapon(p(), uid)));
    }
    if (isArmor(d) && repairCost(it) > 0) actions.push(act(`Reparieren (${formatMoney(repairCost(it))})`, () => repairItem(p(), uid)));
    if (d.cat !== 'cash') {
      const price = sellPrice({ ...it, n: qty() ?? it.n }, sellBonus(p()));
      actions.push(
        h(
          'button',
          {
            class: 'btn small danger',
            onclick: async () => {
              const val = sellPrice({ ...it, n: qty() ?? it.n }, sellBonus(p()));
              if (val > 15000 && !(await confirmDialog(`${d.name} für ${formatMoney(val)} verkaufen?`, 'Verkaufen'))) return;
              close();
              commit(sellItem(p(), uid, qty()));
            },
          },
          `Verkaufen (${formatMoney(price)})`,
        ),
      );
    }
    if (qtyInput) qtyInput.addEventListener('input', () => {
      const sellBtn = actions[actions.length - 1];
      sellBtn.textContent = `Verkaufen (${formatMoney(sellPrice({ ...it, n: qty() ?? it.n }, sellBonus(p())))})`;
    });
    const content = h(
      'div',
      { class: 'item-detail' },
      itemHeader(it),
      itemStats(it),
      qtyInput ? h('div', { class: 'row gap-s', style: { marginBottom: '8px' } }, h('span', { class: 'small muted' }, 'Menge:'), qtyInput, h('span', { class: 'small muted' }, `von ${it.n}`)) : null,
      h('div', { class: 'small muted', style: { marginBottom: '6px' } }, `Ort: ${whereName(where)}`),
      h('div', { class: 'actions' }, actions),
    );
    close = modal(content);
  };

  // ------------------------------------------------------------------
  const gearTab = () => {
    const pr = p();
    const inv = pr.char;
    const left = h('div', { class: 'pane scroll', style: { flex: '1 1 44%' } });
    left.appendChild(h('div', { class: 'pane-head' }, h('h2', null, 'Ausrüstung'), h('span', { class: 'small muted' }, `Wert ${formatMoney(inventoryValue(inv))} · ${inventoryWeight(inv).toFixed(1)} kg`)));
    const eq = h('div', { class: 'equip-grid' });
    for (const s of EQUIP_SLOTS) {
      const it = inv.equip[s];
      eq.appendChild(h('div', { class: 'slot' }, h('div', { class: 'lbl' }, SLOT_NAMES[s]), it ? itemTile(it, { onClick: () => openItem(it.uid) }) : emptySlot('leer')));
    }
    left.appendChild(eq);
    left.appendChild(capRow('Tasche & Rucksack', slotsUsed(inv.bag), bagCapacity(inv)));
    const bag = h('div', { class: 'item-grid' });
    for (const it of sortItems(inv.bag)) bag.appendChild(itemTile(it, { onClick: () => openItem(it.uid) }));
    if (!inv.bag.length) bag.appendChild(h('div', { class: 'muted small' }, 'Leer – nimm Munition und Medizin mit!'));
    left.appendChild(bag);
    left.appendChild(capRow('Sicherer Behälter', slotsUsed(inv.secure), inv.secureCap));
    const sec = h('div', { class: 'item-grid' });
    for (const it of inv.secure) sec.appendChild(itemTile(it, { onClick: () => openItem(it.uid) }));
    left.appendChild(sec);
    if (!inv.secure.length) left.appendChild(h('div', { class: 'muted small' }, 'Inhalt bleibt beim Tod erhalten.'));
    const warns = kitWarnings(pr);
    if (warns.length) left.appendChild(h('div', { class: 'col gap-s' }, warns.map((w) => h('div', { class: 'small warn' }, '⚠ ' + w))));
    const btns = h('div', { class: 'row gap-s wrap' });
    btns.appendChild(h('button', { class: 'btn small', onclick: () => commit(stashAll(pr)) }, 'Tasche → Lager'));
    btns.appendChild(
      h(
        'button',
        {
          class: 'btn small',
          onclick: () => {
            const msgs: string[] = [];
            let ok = false;
            for (const s of ['primary', 'secondary'] as const) {
              const w = pr.char.equip[s];
              if (!w) continue;
              const r = loadWeapon(pr, w.uid);
              ok = ok || r.ok;
              if (r.text) msgs.push(`${itemDef(w.id).short}: ${r.text}`);
            }
            commit({ ok, text: msgs.join(' · ') || 'Keine Waffe ausgerüstet.' });
          },
        },
        'Waffen laden',
      ),
    );
    btns.appendChild(h('button', { class: 'btn small', onclick: () => quickRestock() }, 'Schnell auffüllen'));
    if (!hasAnyWeapon(pr)) btns.appendChild(h('button', { class: 'btn small primary', onclick: () => commit(claimFreeKit(pr), 'good') }, 'Notfall-Ausrüstung'));
    left.appendChild(btns);

    const right = h('div', { class: 'pane', style: { flex: '1 1 56%' } });
    right.appendChild(h('div', { class: 'pane-head' }, h('h2', null, 'Lager'), h('div', { class: 'grow' }), h('button', { class: 'btn small', onclick: () => commit(sellJunk(pr), 'good') }, 'Beute verkaufen')));
    right.appendChild(capRow('Platz', slotsUsed(pr.vault), vaultCap(pr)));
    right.appendChild(
      h(
        'div',
        { class: 'filter-chips' },
        FILTERS.map((f) =>
          h(
            'div',
            {
              class: 'chip' + (filter === f.id ? ' active' : ''),
              onclick: () => {
                filter = f.id;
                render();
              },
            },
            f.label,
          ),
        ),
      ),
    );
    const flt = FILTERS.find((f) => f.id === filter)!;
    const grid = h('div', { class: 'item-grid scroll', style: { flex: '1' } });
    const items = sortItems(pr.vault.filter((it) => !flt.cats || flt.cats.includes(itemDef(it.id).cat)));
    for (const it of items) grid.appendChild(itemTile(it, { onClick: () => openItem(it.uid) }));
    if (!items.length) grid.appendChild(h('div', { class: 'muted' }, 'Nichts hier.'));
    right.appendChild(grid);
    right.appendChild(h('div', { class: 'tiny muted hint-text' }, 'Tippe auf einen Gegenstand für Optionen. Waffen werden vor dem Raid mit Munition aus Lager/Tasche geladen.'));
    return h('div', { class: 'split', style: { flex: '1' } }, left, right);
  };

  /** Füllt Munition für ausgerüstete Waffen und Medizin aus dem Lager in die Tasche. */
  const quickRestock = () => {
    const pr = p();
    const notes: string[] = [];
    for (const s of ['primary', 'secondary'] as const) {
      const w = pr.char.equip[s];
      if (!w) continue;
      const wd = itemDef(w.id) as ReturnType<typeof itemDef> & { caliber: string; mag: number };
      const have = pr.char.bag.filter((x) => itemDef(x.id).cat === 'ammo' && (itemDef(x.id) as { caliber: string }).caliber === wd.caliber).reduce((a, x) => a + x.n, 0);
      const want = wd.mag * (s === 'primary' ? 3 : 2);
      if (have >= want) continue;
      const src = pr.vault.filter((x) => itemDef(x.id).cat === 'ammo' && (itemDef(x.id) as { caliber: string }).caliber === wd.caliber).sort((a, b) => (a.id === w.ammo ? -1 : b.id === w.ammo ? 1 : 0));
      let need = want - have;
      for (const a of src) {
        if (need <= 0) break;
        const n = Math.min(need, a.n);
        const r = moveItem(pr, a.uid, 'bag', n);
        if (r.ok) need -= n;
      }
      if (need > 0) notes.push(`${itemDef(w.id).short}: zu wenig Munition`);
    }
    const medsInBag = pr.char.bag.filter((x) => itemDef(x.id).cat === 'med').length;
    if (medsInBag < 2) {
      for (const m of pr.vault.filter((x) => itemDef(x.id).cat === 'med').slice(0, 2 - medsInBag)) moveItem(pr, m.uid, 'bag', 1);
    }
    for (const s of ['primary', 'secondary'] as const) if (pr.char.equip[s]) loadWeapon(pr, pr.char.equip[s]!.uid);
    commit({ ok: true, text: notes.length ? notes.join(' · ') : 'Munition & Medizin aufgefüllt, Waffen geladen.' });
  };

  // ------------------------------------------------------------------
  const traderTab = () => {
    const pr = p();
    const ll = loyalty(pr);
    const wrap = h('div', { class: 'col gap', style: { width: '100%', minHeight: '0' } });
    const heads = h('div', { class: 'row gap wrap' });
    for (const t of TRADERS) {
      heads.appendChild(
        h(
          'div',
          {
            class: 'trader-head',
            style: { cursor: 'pointer', borderColor: t.id === trader ? 'var(--accent)' : '' },
            onclick: () => {
              trader = t.id;
              traderMode = 'buy';
              render();
            },
          },
          h('div', { class: 'avatar', style: { background: t.color } }, t.name[0]),
          h('div', null, h('div', { style: { fontWeight: '800' } }, t.name), h('div', { class: 'tiny muted' }, t.title)),
          h('span', { class: 'll' }, 'LL' + ll),
        ),
      );
    }
    wrap.appendChild(heads);
    const td = TRADERS.find((t) => t.id === trader)!;
    const nextLL = LL_LEVELS[ll + 1];
    wrap.appendChild(h('div', { class: 'small muted' }, td.desc + ' ', nextLL ? `Nächste Loyalitätsstufe (LL${ll + 1}) ab Level ${nextLL}.` : 'Maximale Loyalität.'));
    wrap.appendChild(
      h(
        'div',
        { class: 'filter-chips' },
        (
          [
            ['buy', 'Kaufen'],
            ['sell', 'Verkaufen'],
            ['repair', 'Reparieren'],
          ] as const
        ).map(([id, label]) =>
          h(
            'div',
            {
              class: 'chip' + (traderMode === id ? ' active' : ''),
              onclick: () => {
                traderMode = id;
                render();
              },
            },
            label,
          ),
        ),
        h('span', { class: 'small muted', style: { marginLeft: '8px' } }, `Lager: ${slotsUsed(pr.vault)}/${vaultCap(pr)}`),
      ),
    );
    const list = h('div', { class: 'offers scroll', style: { flex: '1' } });
    if (traderMode === 'buy') {
      for (const o of OFFERS.filter((x) => x.trader === trader).sort((a, b) => a.ll - b.ll)) {
        const unlocked = offerUnlocked(pr, o);
        const it = { uid: 'offer', id: o.item, n: o.n, ...(isArmor(itemDef(o.item)) ? { dur: (itemDef(o.item) as { dur: number }).dur } : {}) };
        const reason = !unlocked ? (ll < o.ll ? `Ab LL${o.ll} (Level ${LL_LEVELS[o.ll]})` : `Auftrag: ${questDef(o.quest!)?.title}`) : '';
        const owned = countOwned(pr, o.item);
        list.appendChild(
          h(
            'div',
            { class: 'offer' },
            itemTile(it as ItemStack, { locked: !unlocked, onClick: () => modal(h('div', { class: 'item-detail' }, itemHeader(it as ItemStack), itemStats(it as ItemStack))) }),
            h('div', { class: 'info' }, h('div', { class: 'n' }, itemDef(o.item).name + (o.n > 1 ? ` ×${o.n}` : '')), h('div', { class: 'price' }, formatMoney(o.price)), h('div', { class: 'tiny muted' }, reason || (owned ? `Besitz: ${owned}` : ''))),
            h(
              'div',
              { class: 'col gap-s' },
              h('button', { class: 'btn small primary', disabled: !unlocked || pr.money < o.price, onclick: () => commit(buyOffer(pr, o, 1)) }, 'Kaufen'),
              o.n > 1 || itemDef(o.item).cat === 'med' ? h('button', { class: 'btn small', disabled: !unlocked || pr.money < o.price * 3, onclick: () => commit(buyOffer(pr, o, 3)) }, '×3') : null,
            ),
          ),
        );
      }
    } else if (traderMode === 'sell') {
      const bonus = sellBonus(pr);
      const sellables = sortItems([...pr.vault, ...pr.char.bag].filter((it) => itemDef(it.id).cat !== 'cash'));
      if (!sellables.length) list.appendChild(h('div', { class: 'muted' }, 'Nichts zu verkaufen.'));
      for (const it of sellables) {
        list.appendChild(
          h(
            'div',
            { class: 'offer' },
            itemTile(it, { onClick: () => openItem(it.uid) }),
            h('div', { class: 'info' }, h('div', { class: 'n' }, itemDef(it.id).name + (it.n > 1 ? ` ×${it.n}` : '')), h('div', { class: 'price' }, formatMoney(sellPrice(it, bonus))), h('div', { class: 'tiny muted' }, pr.vault.includes(it) ? 'Lager' : 'Tasche')),
            h('button', { class: 'btn small', onclick: () => commit(sellItem(pr, it.uid), 'good') }, 'Verkaufen'),
          ),
        );
      }
    } else {
      const armors = [...pr.vault, ...pr.char.bag, ...(Object.values(pr.char.equip) as ItemStack[])].filter((it) => it && isArmor(itemDef(it.id)) && repairCost(it) > 0);
      if (!armors.length) list.appendChild(h('div', { class: 'muted' }, 'Keine beschädigte Panzerung.'));
      for (const it of armors) {
        const cost = repairCost(it);
        list.appendChild(
          h(
            'div',
            { class: 'offer' },
            itemTile(it),
            h('div', { class: 'info' }, h('div', { class: 'n' }, itemDef(it.id).name), h('div', { class: 'tiny muted' }, `Haltbarkeit ${Math.round(it.dur ?? 0)}/${(itemDef(it.id) as { dur: number }).dur}`), h('div', { class: 'price' }, formatMoney(cost))),
            h('button', { class: 'btn small primary', disabled: pr.money < cost, onclick: () => commit(repairItem(pr, it.uid), 'good') }, 'Reparieren'),
          ),
        );
      }
    }
    wrap.appendChild(list);
    return wrap;
  };

  // ------------------------------------------------------------------
  const questsTab = () => {
    const pr = p();
    const wrap = h('div', { class: 'cards scroll' });
    const order = { complete: 0, active: 1, locked: 2, claimed: 3 } as const;
    const list = [...QUESTS].sort((a, b) => order[questStatus(pr, a)] - order[questStatus(pr, b)] || a.level - b.level);
    let shownLocked = 0;
    for (const q of list) {
      const st = questStatus(pr, q);
      if (st === 'locked') {
        if (shownLocked++ >= 4) continue;
      }
      const giver = TRADERS.find((t) => t.id === q.giver)!;
      const state = pr.quests[q.id];
      const card = h('div', { class: 'card' + (st === 'complete' ? ' done' : ''), style: st === 'claimed' ? { opacity: '0.55' } : st === 'locked' ? { opacity: '0.7' } : {} });
      card.appendChild(
        h(
          'div',
          { class: 'title-row' },
          h('div', null, h('div', { style: { fontWeight: '800' } }, q.title), h('div', { class: 'tiny', style: { color: giver.color } }, giver.name)),
          h('span', { class: 'll' }, st === 'claimed' ? '✓ erledigt' : st === 'complete' ? 'ABGESCHLOSSEN' : st === 'locked' ? `ab Level ${q.level}` : 'aktiv'),
        ),
      );
      card.appendChild(h('div', { class: 'small muted', style: { margin: '6px 0' } }, q.desc));
      if (st === 'locked' && !questAvailable(pr, q) && profileLevel(pr) >= q.level) {
        card.appendChild(h('div', { class: 'tiny warn' }, 'Vorher: ' + (q.prereq ?? []).map((id) => questDef(id)?.title).join(', ')));
      }
      q.objectives.forEach((o, i) => {
        const target = objectiveTarget(o);
        const cur = state ? Math.min(target, state.progress[i] ?? 0) : 0;
        const done = cur >= target;
        const row = h('div', { class: 'obj' + (done ? ' ok' : '') }, h('span', { class: 'grow' }, (done ? '✓ ' : '• ') + o.text), h('div', { class: 'bar' }, h('div', { style: { width: (cur / target) * 100 + '%' } })), h('span', { class: 'mono tiny' }, `${cur}/${target}`));
        card.appendChild(row);
        if (o.type === 'handover' && st === 'active' && !done) {
          const owned = countOwned(pr, o.item);
          card.appendChild(h('div', { class: 'row gap-s', style: { marginTop: '4px' } }, h('button', { class: 'btn small', disabled: owned === 0, onclick: () => commit(handover(pr, q.id, i)) }, `Übergeben (${owned} vorhanden)`)));
        }
      });
      const rw = q.rewards;
      card.appendChild(
        h(
          'div',
          { class: 'tiny', style: { marginTop: '8px', color: 'var(--accent2)' } },
          `Belohnung: ${formatMoney(rw.money)} · ${rw.xp} XP` + (rw.items?.length ? ' · ' + rw.items.map((x) => `${x.n > 1 ? x.n + '× ' : ''}${itemDef(x.id).short}`).join(', ') : '') + (rw.unlock ? ' · ' + rw.unlock : ''),
        ),
      );
      if (st === 'complete') card.appendChild(h('button', { class: 'btn primary small', style: { marginTop: '8px' }, onclick: () => commit(claimQuest(pr, q.id), 'good') }, 'Belohnung abholen'));
      wrap.appendChild(card);
    }
    return wrap;
  };

  // ------------------------------------------------------------------
  const upgradesTab = () => {
    const pr = p();
    const wrap = h('div', { class: 'cards scroll' });
    for (const u of UPGRADES) {
      const lvl = pr.upgrades[u.id];
      const cur = u.levels[lvl - 1];
      const next = u.levels[lvl];
      const card = h('div', { class: 'card' });
      card.appendChild(h('div', { class: 'title-row' }, h('div', { style: { fontWeight: '800' } }, u.name), h('span', { class: 'll' }, `Stufe ${lvl}/${u.levels.length}`)));
      card.appendChild(h('div', { class: 'small muted', style: { margin: '6px 0' } }, u.desc));
      card.appendChild(h('div', { class: 'small' }, 'Aktuell: ', h('b', null, cur.text)));
      if (next) {
        card.appendChild(h('div', { class: 'small', style: { marginTop: '4px' } }, 'Nächste Stufe: ', h('b', { class: 'accent' }, next.text)));
        const reqs = h('div', { class: 'col gap-s', style: { margin: '6px 0' } });
        const lvOk = profileLevel(pr) >= next.level;
        reqs.appendChild(h('div', { class: 'small ' + (lvOk ? 'good' : 'bad') }, `${lvOk ? '✓' : '✗'} Level ${next.level}`));
        const moneyOk = pr.money >= next.cost;
        reqs.appendChild(h('div', { class: 'small ' + (moneyOk ? 'good' : 'bad') }, `${moneyOk ? '✓' : '✗'} ${formatMoney(next.cost)}`));
        for (const r of next.items) {
          const have = countOwned(pr, r.id);
          reqs.appendChild(h('div', { class: 'small ' + (have >= r.n ? 'good' : 'bad') }, `${have >= r.n ? '✓' : '✗'} ${r.n}× ${itemDef(r.id).name} (${have})`));
        }
        card.appendChild(reqs);
        card.appendChild(h('button', { class: 'btn primary small', onclick: () => commit(buyUpgrade(pr, u.id), 'good') }, 'Ausbauen'));
      } else card.appendChild(h('div', { class: 'small good', style: { marginTop: '6px' } }, 'Vollständig ausgebaut.'));
      wrap.appendChild(card);
    }
    return wrap;
  };

  // ------------------------------------------------------------------
  const profileTab = () => {
    const pr = p();
    const s = pr.stats;
    const lp = levelProgress(pr.xp);
    const nameIn = h('input', { value: pr.name, maxlength: '16' }) as HTMLInputElement;
    const colorRow = h(
      'div',
      { class: 'row gap-s' },
      PLAYER_COLORS.map((c) =>
        h('div', {
          style: { width: '28px', height: '28px', borderRadius: '50%', background: c, cursor: 'pointer', border: c === pr.color ? '3px solid #fff' : '2px solid #000' },
          onclick: () => {
            pr.color = c;
            app.save();
            render();
          },
        }),
      ),
    );
    const kd = s.deaths ? (Object.values(s.kills).reduce((a, b) => a + b, 0) / Math.max(1, s.deaths)).toFixed(2) : '–';
    const stats: [string, string][] = [
      ['Level', `${lp.level} (${pr.xp.toLocaleString('de-DE')} XP)`],
      ['Raids', String(s.raids)],
      ['Überlebt', `${s.extracts} (${s.raids ? Math.round((s.extracts / s.raids) * 100) : 0} %)`],
      ['Gefallen / Vermisst', `${s.deaths} / ${s.mia}`],
      ['Plünderer / Söldner', `${s.kills.scav} / ${s.kills.pmc}`],
      ['Wachen / Bosse', `${s.kills.guard} / ${s.kills.boss}`],
      ['Kopfschüsse', String(s.headshots)],
      ['K/D', kd],
      ['Heli-Extraktionen', String(s.heliExtracts)],
      ['Beutewert gesamt', formatMoney(s.lootValue)],
      ['Bester Raid', formatMoney(s.bestRaid)],
      ['Spielzeit im Raid', formatTime(s.playTime)],
    ];
    const kv = h('div', { class: 'kv' });
    for (const [k, v] of stats) kv.append(h('div', { class: 'muted' }, k), h('div', { class: 'v' }, v));
    return h(
      'div',
      { class: 'split scroll', style: { flex: '1' } },
      h(
        'div',
        { class: 'pane', style: { flex: '1' } },
        h('h2', null, 'Operator'),
        h('div', { class: 'form-row' }, h('label', null, 'Name'), h('div', { class: 'row gap-s' }, nameIn, h('button', { class: 'btn small', onclick: () => {
          pr.name = nameIn.value.trim().slice(0, 16) || pr.name;
          app.save();
          toast('Name gespeichert', 'good');
          render();
        } }, 'Speichern'))),
        h('div', { class: 'form-row' }, h('label', null, 'Farbe'), colorRow),
        h('h2', { style: { marginTop: '10px' } }, 'Statistik'),
        kv,
      ),
      h(
        'div',
        { class: 'pane', style: { flex: '1' } },
        h('h2', null, 'Spielstand'),
        h('p', { class: 'small muted' }, 'Der Spielstand wird lokal auf diesem Gerät gespeichert. Mit einem Export-Code kannst du ihn sichern oder auf ein anderes Gerät (z. B. PC → iPhone) übertragen.'),
        h('button', {
          class: 'btn small',
          onclick: () => {
            const code = exportProfile(pr);
            const ta = h('textarea', { style: { width: 'min(460px,80vw)', height: '140px', fontFamily: 'var(--mono)', fontSize: '11px', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--line2)', borderRadius: '6px', userSelect: 'text' } }, code) as HTMLTextAreaElement;
            modal(h('div', { class: 'col gap' }, h('h2', null, 'Export-Code'), ta, h('button', { class: 'btn primary small', onclick: () => {
              ta.select();
              navigator.clipboard?.writeText(code).then(() => toast('Kopiert!', 'good'), () => toast('Bitte manuell kopieren', 'warn'));
            } }, 'In Zwischenablage kopieren')));
          },
        }, 'Spielstand exportieren'),
        h('button', {
          class: 'btn small',
          onclick: () => {
            const ta = h('textarea', { style: { width: 'min(460px,80vw)', height: '140px', fontFamily: 'var(--mono)', fontSize: '11px', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--line2)', borderRadius: '6px' }, placeholder: 'Export-Code hier einfügen' }) as HTMLTextAreaElement;
            let close = () => {};
            close = modal(h('div', { class: 'col gap' }, h('h2', null, 'Spielstand importieren'), h('p', { class: 'small warn' }, 'Achtung: Der aktuelle Spielstand wird überschrieben.'), ta, h('button', { class: 'btn primary small', onclick: () => {
              try {
                app.profile = importProfile(ta.value);
                app.save();
                close();
                toast('Spielstand importiert!', 'good');
                render();
              } catch {
                toast('Ungültiger Code', 'bad');
              }
            } }, 'Importieren')));
          },
        }, 'Spielstand importieren'),
        h('button', {
          class: 'btn small danger',
          onclick: async () => {
            if (!(await confirmDialog('Profil wirklich zurücksetzen? Alles geht verloren.', 'Zurücksetzen'))) return;
            app.profile = newProfile(pr.name);
            app.save();
            toast('Neues Profil erstellt', 'good');
            render();
          },
        }, 'Profil zurücksetzen'),
      ),
    );
  };

  render();
  return root;
}

function capRow(label: string, used: number, cap: number) {
  return h(
    'div',
    { class: 'row gap-s' },
    h('h3', null, label),
    h('div', { class: 'capbar' + (used >= cap ? ' full' : '') }, h('div', { style: { width: Math.min(100, (used / Math.max(1, cap)) * 100) + '%' } })),
    h('span', { class: 'small mono' }, `${used}/${cap}`),
  );
}

function sortItems(list: ItemStack[]): ItemStack[] {
  return [...list].sort((a, b) => {
    const da = itemDef(a.id);
    const db = itemDef(b.id);
    const c = CAT_ORDER.indexOf(da.cat) - CAT_ORDER.indexOf(db.cat);
    if (c) return c;
    return stackValue(b) - stackValue(a);
  });
}

function whereName(w: Where) {
  return { vault: 'Lager', equip: 'Ausgerüstet', bag: 'Tasche', secure: 'Sicherer Behälter' }[w];
}
