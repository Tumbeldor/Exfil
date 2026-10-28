import { cloneInventory, inventoryValue } from '../../../shared/inventory';
import { formatMoney } from '../../../shared/math';
import type { JoinPayload } from '../../../shared/net/protocol';
import { kitWarnings, profileLevel, regenRate, secureCap } from '../../../shared/profile';
import { defaultServerUrl } from '../../net/NetClient';
import type { App } from '../App';
import { clear, h, toast } from '../dom';
import { escapeHtml } from '../../game/Hud';
import { DIFFICULTIES, mapCards } from './raidprep';

export function kitPayload(app: App): JoinPayload {
  const p = app.profile;
  const inv = cloneInventory(p.char);
  inv.secureCap = secureCap(p);
  return { name: p.name, level: profileLevel(p), color: p.color, regen: regenRate(p), inv, kitValue: inventoryValue(inv) };
}

export function lobbyScreen(app: App): HTMLElement {
  const root = h('div', { class: 'screen' });
  const url = defaultServerUrl(app.settings.serverUrl);
  const net = app.ensureNet(url);
  const chat: { from: string; text: string }[] = [];
  let busy = false;
  const offs: (() => void)[] = [];
  const cleanup = () => offs.forEach((f) => f());
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      cleanup();
      observer.disconnect();
    }
  });
  setTimeout(() => observer.observe(app.ui, { childList: true }), 0);

  offs.push(net.onLobby(() => render()));
  offs.push(net.onState(() => render()));
  offs.push(net.onError((t) => toast(t, 'bad')));
  offs.push(
    net.onChat((m) => {
      chat.push(m);
      if (chat.length > 30) chat.shift();
      render();
    }),
  );

  const render = () => {
    if (!root.isConnected && root.childElementCount) return;
    clear(root);
    root.appendChild(
      h(
        'div',
        { class: 'topbar' },
        h('button', { class: 'btn small', onclick: () => app.goMenu() }, '← Menü'),
        h('h2', null, 'Coop'),
        h('span', { class: 'small muted' }, net.state === 'open' ? `Verbunden${net.rtt ? ` · ${Math.round(net.rtt)} ms` : ''}` : net.state === 'connecting' ? 'Verbinde …' : 'Nicht verbunden'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn small', onclick: () => app.goHideout() }, 'Versteck'),
      ),
    );
    const body = h('div', { class: 'tab-body', style: { borderRadius: '8px' } });
    root.appendChild(body);
    if (net.state !== 'open') {
      const nameIn = h('input', { value: app.profile.name, maxlength: '16' }) as HTMLInputElement;
      const srvIn = h('input', { value: app.settings.serverUrl, placeholder: location.host || 'server:3000', style: { minWidth: '240px' } }) as HTMLInputElement;
      body.appendChild(
        h(
          'div',
          { class: 'col gap', style: { maxWidth: '460px', margin: '0 auto', width: '100%' } },
          h('h2', null, 'Mit Coop-Server verbinden'),
          h('p', { class: 'small muted' }, 'Im Coop spielt ihr gemeinsam gegen die Bots. Alle Spieler verbinden sich mit demselben Server – auf dem PC per „npm start“ gestartet oder online gehostet. Jeder bringt seine eigene Ausrüstung mit und behält seine Beute.'),
          h('div', { class: 'form-row' }, h('label', null, 'Name'), nameIn),
          h('div', { class: 'form-row' }, h('label', null, 'Server (leer = diese Seite)'), srvIn),
          h(
            'button',
            {
              class: 'btn primary',
              disabled: busy,
              onclick: async () => {
                app.profile.name = nameIn.value.trim().slice(0, 16) || app.profile.name;
                app.save();
                if (srvIn.value.trim() !== app.settings.serverUrl) {
                  app.settings.serverUrl = srvIn.value.trim();
                  app.saveSettings();
                  app.goLobby();
                  return;
                }
                busy = true;
                render();
                try {
                  await net.connect(app.profile.name);
                } catch {
                  toast('Server nicht erreichbar: ' + url, 'bad', 4000);
                }
                busy = false;
                render();
              },
            },
            busy ? 'Verbinde …' : 'Verbinden',
          ),
          h('div', { class: 'tiny muted' }, 'Adresse: ' + url),
        ),
      );
      return;
    }
    const lobby = net.lobby;
    if (!lobby) {
      const codeIn = h('input', { placeholder: 'CODE', maxlength: '4', style: { textTransform: 'uppercase', width: '120px', letterSpacing: '0.3em', fontFamily: 'var(--mono)' } }) as HTMLInputElement;
      body.appendChild(
        h(
          'div',
          { class: 'col gap', style: { maxWidth: '460px', margin: '0 auto', width: '100%' } },
          h('h2', null, 'Lobby'),
          h('button', { class: 'btn primary big', onclick: () => net.send({ type: 'create', name: app.profile.name }) }, 'Neue Lobby erstellen'),
          h('div', { class: 'muted center' }, '– oder –'),
          h('div', { class: 'row gap' }, codeIn, h('button', { class: 'btn', onclick: () => net.send({ type: 'join', code: codeIn.value.trim().toUpperCase(), name: app.profile.name }) }, 'Beitreten')),
          h('div', { class: 'tiny muted' }, 'Teile den 4-stelligen Code mit deinen Freunden.'),
        ),
      );
      return;
    }
    const me = lobby.players.find((x) => x.id === net.id);
    const isHost = lobby.hostId === net.id;
    const allReady = lobby.players.length > 0 && lobby.players.every((x) => x.ready);
    const list = h('div', { class: 'lobby-players' });
    for (const pl of lobby.players) {
      list.appendChild(
        h(
          'div',
          { class: 'lobby-player', style: { opacity: pl.connected ? '1' : '0.5' } },
          h('span', { class: 'dot', style: { background: pl.color } }),
          h('b', null, pl.name),
          h('span', { class: 'll' }, 'Lv ' + pl.level),
          pl.id === lobby.hostId ? h('span', { class: 'tiny accent' }, '★ Host') : null,
          h('div', { class: 'grow' }),
          h('span', { class: 'tiny muted' }, pl.kitValue ? formatMoney(pl.kitValue) : ''),
          h('span', { class: pl.inRaid ? 'warn small' : pl.ready ? 'good small' : 'muted small' }, pl.inRaid ? 'im Raid' : pl.ready ? '✓ bereit' : 'nicht bereit'),
        ),
      );
    }
    const settingsBox = h('div', { class: 'col gap-s' });
    settingsBox.appendChild(h('h3', null, 'Zone' + (isHost ? '' : ' (wählt der Host)')));
    settingsBox.appendChild(mapCards(app, lobby.mapId, (id) => isHost && net.send({ type: 'settings', mapId: id }), isHost));
    settingsBox.appendChild(
      h(
        'div',
        { class: 'row gap wrap' },
        h('h3', null, 'Schwierigkeit'),
        h(
          'div',
          { class: 'filter-chips' },
          DIFFICULTIES.map((d, i) => h('div', { class: 'chip' + (lobby.difficulty === i ? ' active' : ''), onclick: () => isHost && net.send({ type: 'settings', difficulty: i }) }, d)),
        ),
        h('h3', null, 'Eigenbeschuss'),
        h('div', { class: 'switch' + (lobby.friendlyFire ? ' on' : ''), onclick: () => isHost && net.send({ type: 'settings', friendlyFire: !lobby.friendlyFire }) }),
      ),
    );
    const chatIn = h('input', { placeholder: 'Nachricht …', maxlength: '120', style: { flex: '1' } }) as HTMLInputElement;
    chatIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && chatIn.value.trim()) {
        net.send({ type: 'chat', text: chatIn.value.trim() });
        chatIn.value = '';
      }
    });
    const warns = kitWarnings(app.profile);
    body.appendChild(
      h(
        'div',
        { class: 'split', style: { flex: '1', width: '100%' } },
        h(
          'div',
          { class: 'pane scroll', style: { flex: '1' } },
          h('div', { class: 'row gap' }, h('div', null, h('div', { class: 'tiny muted' }, 'LOBBY-CODE'), h('div', { class: 'code' }, lobby.code)), h('button', { class: 'btn small', onclick: () => navigator.clipboard?.writeText(lobby.code).then(() => toast('Code kopiert', 'good')) }, 'Kopieren')),
          list,
          warns.length ? h('div', { class: 'col gap-s' }, warns.map((w) => h('div', { class: 'small warn' }, '⚠ ' + w))) : null,
          h(
            'div',
            { class: 'row gap wrap' },
            h(
              'button',
              {
                class: 'btn ' + (me?.ready ? '' : 'primary'),
                disabled: lobby.raidActive,
                onclick: () => net.send(me?.ready ? { type: 'ready', ready: false } : { type: 'ready', ready: true, kit: kitPayload(app) }),
              },
              me?.ready ? 'Nicht bereit' : 'Bereit',
            ),
            h('button', { class: 'btn', onclick: () => {
              if (me?.ready) net.send({ type: 'ready', ready: false });
              app.goHideout();
            } }, 'Ausrüstung ändern'),
            isHost ? h('button', { class: 'btn primary', disabled: !allReady || lobby.raidActive, onclick: () => net.send({ type: 'start' }) }, 'Raid starten ▶') : null,
            h('button', { class: 'btn danger small', onclick: () => {
              net.send({ type: 'leave' });
            } }, 'Lobby verlassen'),
          ),
          lobby.raidActive ? h('div', { class: 'small warn' }, 'Ein Raid läuft gerade. Warte, bis alle zurück sind.') : null,
          h('div', { class: 'col gap-s' }, h('h3', null, 'Chat'), h('div', { class: 'small', html: chat.slice(-8).map((m) => `<div><b>${escapeHtml(m.from)}:</b> ${escapeHtml(m.text)}</div>`).join('') || '<span class="muted">Noch keine Nachrichten</span>' }), h('div', { class: 'row gap-s' }, chatIn)),
        ),
        h('div', { class: 'pane scroll', style: { flex: '1.3' } }, settingsBox),
      ),
    );
  };
  render();
  if (net.state === 'idle' || net.state === 'closed') {
    busy = true;
    net
      .connect(app.profile.name)
      .catch(() => {})
      .finally(() => {
        busy = false;
        render();
      });
  }
  return root;
}
