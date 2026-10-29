import { cloneInventory, inventoryValue } from '../../../shared/inventory';
import { formatMoney } from '../../../shared/math';
import type { JoinPayload, LobbyState } from '../../../shared/net/protocol';
import { kitWarnings, profileLevel, regenRate, secureCap } from '../../../shared/profile';
import { escapeHtml } from '../../game/Hud';
import { type NetClient, defaultServerUrl } from '../../net/NetClient';
import type { App } from '../App';
import { clear, h, modal, toast } from '../dom';
import { DIFFICULTIES, mapCards } from './raidprep';

export function kitPayload(app: App): JoinPayload {
  const p = app.profile;
  const inv = cloneInventory(p.char);
  inv.secureCap = secureCap(p);
  return { name: p.name, level: profileLevel(p), color: p.color, regen: regenRate(p), inv, kitValue: inventoryValue(inv) };
}

/** Einladungslink teilen: native Teilen-Funktion (iPhone), sonst Zwischenablage, sonst anzeigen. */
export async function shareInvite(url: string, code: string) {
  const text = `Komm in meine Extraction-Looter-Lobby! Code: ${code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Extraction Looter – Coop', text, url });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Einladungslink kopiert!', 'good');
    return;
  } catch {
    /* kein Zugriff */
  }
  const inp = h('input', { value: url, readonly: true, style: { width: 'min(460px,80vw)', userSelect: 'text' } }) as HTMLInputElement;
  modal(h('div', { class: 'col gap' }, h('h2', null, 'Einladungslink'), h('p', { class: 'small muted' }, 'Kopiere den Link und schicke ihn deinen Freunden:'), inp));
  setTimeout(() => inp.select(), 50);
}

export function lobbyScreen(app: App): HTMLElement {
  const root = h('div', { class: 'screen' });
  const chat: { from: string; text: string }[] = [];
  let busy = '';
  let serverKnown = false;
  let bound: NetClient | null = null;
  let offs: (() => void)[] = [];
  const pending = app.pendingJoin;
  app.pendingJoin = null;
  if (pending) app.coopMode = pending.mode;
  let mode: 'p2p' | 'server' = app.coopMode ?? (app.settings.serverUrl ? 'server' : 'p2p');

  const unbind = () => {
    offs.forEach((f) => f());
    offs = [];
    bound = null;
  };
  const bind = () => {
    const net = app.net;
    if (net === bound) return;
    unbind();
    bound = net;
    if (!net) return;
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
  };
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      unbind();
      observer.disconnect();
    }
  });
  setTimeout(() => observer.observe(app.ui, { childList: true }), 0);

  const run = async (label: string, fn: () => Promise<unknown>, fail: string) => {
    busy = label;
    render();
    try {
      await fn();
    } catch (e) {
      console.warn(e);
      toast(fail, 'bad', 5000);
    }
    busy = '';
    bind();
    render();
  };

  const hostP2P = () => run('host', () => app.hostP2P(), 'Lobby konnte nicht erstellt werden – bist du online?');
  const joinP2P = (code: string) => {
    if (!/^[A-Z0-9]{4}$/i.test(code)) return toast('Bitte den 4-stelligen Code eingeben.', 'warn');
    return run('join', () => app.joinP2P(code), `Lobby ${code.toUpperCase()} nicht erreichbar. Ist der Host online?`);
  };
  const connectServer = () =>
    run(
      'connect',
      async () => {
        const net = app.ensureServerNet(defaultServerUrl(app.settings.serverUrl));
        bind();
        if (net.state !== 'open') await net.connect(app.profile.name);
      },
      'Server nicht erreichbar: ' + defaultServerUrl(app.settings.serverUrl),
    );

  const render = () => {
    if (!root.isConnected && root.childElementCount) return;
    bind();
    clear(root);
    const net = app.net;
    const status = !net
      ? 'Nicht verbunden'
      : net.state === 'open'
        ? `Verbunden${net.kind === 'p2p-host' ? ' (Host)' : ''}${net.rtt > 1 ? ` · ${Math.round(net.rtt)} ms` : ''}`
        : net.state === 'connecting'
          ? 'Verbinde …'
          : net.state === 'failed'
            ? 'Verbindung verloren'
            : 'Nicht verbunden';
    root.appendChild(
      h(
        'div',
        { class: 'topbar' },
        h('button', { class: 'btn small', onclick: () => app.goMenu() }, '← Menü'),
        h('h2', null, 'Coop'),
        h('span', { class: 'small muted' }, status),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn small', onclick: () => app.goHideout() }, 'Versteck'),
      ),
    );
    const body = h('div', { class: 'tab-body', style: { borderRadius: '8px' } });
    root.appendChild(body);
    if (net && net.lobby) {
      body.appendChild(lobbyView(net, net.lobby));
      return;
    }
    body.appendChild(setupView(net));
  };

  // ---------------- Verbinden / Lobby wählen ----------------
  const setupView = (net: NetClient | null) => {
    const wrap = h('div', { class: 'col gap', style: { maxWidth: '520px', margin: '0 auto', width: '100%' } });
    if (net?.state === 'failed') {
      wrap.appendChild(h('div', { class: 'panel small', style: { padding: '10px 12px', borderColor: 'var(--bad)' } }, 'Die Verbindung zur Lobby wurde getrennt (Host offline oder Netzwerkproblem).'));
    }
    wrap.appendChild(
      h(
        'div',
        { class: 'filter-chips' },
        h('div', { class: 'chip' + (mode === 'p2p' ? ' active' : ''), onclick: () => ((mode = 'p2p'), (app.coopMode = mode), render()) }, 'Online (direkt, ohne Server)'),
        h('div', { class: 'chip' + (mode === 'server' ? ' active' : ''), onclick: () => ((mode = 'server'), (app.coopMode = mode), render()) }, 'Eigener Server' + (serverKnown ? ' ✓' : '')),
      ),
    );
    const nameIn = h('input', { value: app.profile.name, maxlength: '16' }) as HTMLInputElement;
    nameIn.addEventListener('change', () => {
      app.profile.name = nameIn.value.trim().slice(0, 16) || app.profile.name;
      app.save();
    });
    wrap.appendChild(h('div', { class: 'form-row' }, h('label', null, 'Dein Name'), nameIn));
    const codeIn = h('input', { placeholder: 'CODE', maxlength: '4', style: { textTransform: 'uppercase', width: '130px', letterSpacing: '0.3em', fontFamily: 'var(--mono)' } }) as HTMLInputElement;

    if (mode === 'p2p') {
      codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && joinP2P(codeIn.value));
      wrap.append(
        h('h2', null, 'Coop online'),
        h('p', { class: 'small muted', style: { margin: '0' } }, 'Erstelle eine Lobby und schicke deinen Freunden den Einladungslink – oder tritt mit einem Code bei. Die Verbindung läuft direkt zwischen euren Browsern (WebRTC). Der Host betreibt den Raid und muss die Seite geöffnet lassen.'),
        h('button', { class: 'btn primary big', disabled: !!busy, onclick: () => hostP2P() }, busy === 'host' ? 'Erstelle Lobby …' : 'Lobby erstellen'),
        h('div', { class: 'muted center' }, '– oder –'),
        h('div', { class: 'row gap' }, codeIn, h('button', { class: 'btn', disabled: !!busy, onclick: () => joinP2P(codeIn.value) }, busy === 'join' ? 'Verbinde …' : 'Beitreten')),
      );
    } else {
      const srvIn = h('input', { value: app.settings.serverUrl, placeholder: serverKnown ? 'diese Seite' : 'z. B. 192.168.0.10:3000', style: { minWidth: '240px' } }) as HTMLInputElement;
      srvIn.addEventListener('change', () => {
        app.settings.serverUrl = srvIn.value.trim();
        app.saveSettings();
      });
      const connected = net?.kind === 'server' && net.state === 'open';
      wrap.append(
        h('h2', null, 'Eigener Coop-Server'),
        h('p', { class: 'small muted', style: { margin: '0' } }, 'Alle verbinden sich mit einem Node.js-Server („npm start“ auf einem PC oder online gehostet). Stabil auch bei vielen Spielern – der Raid läuft unabhängig von einzelnen Geräten.'),
        h('div', { class: 'form-row' }, h('label', null, 'Server-Adresse (leer = diese Seite)'), srvIn),
      );
      if (!connected) {
        wrap.append(h('button', { class: 'btn primary', disabled: !!busy, onclick: () => connectServer() }, busy === 'connect' ? 'Verbinde …' : 'Verbinden'), h('div', { class: 'tiny muted' }, 'Adresse: ' + defaultServerUrl(app.settings.serverUrl)));
      } else {
        codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && net!.send({ type: 'join', code: codeIn.value.trim().toUpperCase(), name: app.profile.name }));
        wrap.append(
          h('button', { class: 'btn primary big', onclick: () => net!.send({ type: 'create', name: app.profile.name }) }, 'Neue Lobby erstellen'),
          h('div', { class: 'muted center' }, '– oder –'),
          h('div', { class: 'row gap' }, codeIn, h('button', { class: 'btn', onclick: () => net!.send({ type: 'join', code: codeIn.value.trim().toUpperCase(), name: app.profile.name }) }, 'Beitreten')),
        );
      }
    }
    return wrap;
  };

  // ---------------- In der Lobby ----------------
  const lobbyView = (net: NetClient, lobby: LobbyState) => {
    const me = lobby.players.find((x) => x.id === net.id);
    const isHost = lobby.hostId === net.id;
    const allReady = lobby.players.length > 0 && lobby.players.every((x) => x.ready);
    const linkMode = net.kind === 'server' ? 'server' : 'p2p';
    const invite = app.inviteUrl(lobby.code, linkMode);
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
          h('span', { class: pl.inRaid ? 'warn small' : pl.ready ? 'good small' : 'muted small' }, !pl.connected ? 'getrennt' : pl.inRaid ? 'im Raid' : pl.ready ? '✓ bereit' : 'nicht bereit'),
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
    const leave = () => {
      if (net.kind === 'server') net.send({ type: 'leave' });
      else app.leaveNet();
      render();
    };
    return h(
      'div',
      { class: 'split', style: { flex: '1', width: '100%' } },
      h(
        'div',
        { class: 'pane scroll', style: { flex: '1' } },
        h(
          'div',
          { class: 'row gap wrap' },
          h('div', null, h('div', { class: 'tiny muted' }, 'LOBBY-CODE'), h('div', { class: 'code' }, lobby.code)),
          h('button', { class: 'btn small primary', onclick: () => shareInvite(invite, lobby.code) }, 'Einladungslink teilen'),
        ),
        h('div', { class: 'tiny muted', style: { wordBreak: 'break-all', userSelect: 'text' } }, invite),
        net.kind === 'p2p-host'
          ? h('div', { class: 'small', style: { color: 'var(--accent2)' } }, 'Du bist Host: Lass diese Seite geöffnet und im Vordergrund – auch während des Raids. Schließt du sie, endet die Lobby für alle.')
          : null,
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
          h('button', { class: 'btn', onclick: () => app.goHideout() }, 'Ausrüstung ändern'),
          isHost ? h('button', { class: 'btn primary', disabled: !allReady || lobby.raidActive, onclick: () => net.send({ type: 'start' }) }, 'Raid starten ▶') : null,
          h('button', { class: 'btn danger small', onclick: leave }, net.kind === 'p2p-host' ? 'Lobby schließen' : 'Lobby verlassen'),
        ),
        lobby.raidActive ? h('div', { class: 'small warn' }, 'Ein Raid läuft gerade. Warte, bis alle zurück sind.') : null,
        h(
          'div',
          { class: 'col gap-s' },
          h('h3', null, 'Chat'),
          h('div', { class: 'small', html: chat.slice(-8).map((m) => `<div><b>${escapeHtml(m.from)}:</b> ${escapeHtml(m.text)}</div>`).join('') || '<span class="muted">Noch keine Nachrichten</span>' }),
          h('div', { class: 'row gap-s' }, chatIn),
        ),
      ),
      h('div', { class: 'pane scroll', style: { flex: '1.3' } }, settingsBox),
    );
  };

  render();
  // Läuft ein eigener Server unter dieser Adresse? Dann ist das der Standard.
  void app.detectServer().then((ok) => {
    serverKnown = ok;
    if (ok && !app.coopMode && !pending) {
      mode = 'server';
      app.coopMode = 'server';
    }
    if (!pending && mode === 'server' && !app.net && ok) void connectServer();
    else render();
  });
  if (pending) {
    setTimeout(() => {
      if (pending.mode === 'p2p') void joinP2P(pending.code);
      else
        void run(
          'connect',
          async () => {
            const net = app.ensureServerNet(defaultServerUrl(app.settings.serverUrl));
            bind();
            if (net.state !== 'open') await net.connect(app.profile.name);
            net.send({ type: 'join', code: pending.code, name: app.profile.name });
          },
          'Server nicht erreichbar.',
        );
    }, 50);
  }
  return root;
}
