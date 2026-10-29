import { buildMap, mapMeta } from '../../shared/map/maps';
import { type Profile, abandonRaid, applyRaidResult, beginRaid, profileLevel, regenRate, type RaidReport } from '../../shared/profile';
import type { HostMsg } from '../../shared/net/protocol';
import type { RaidResult } from '../../shared/sim/types';
import { audio } from '../game/Audio';
import { MapPainter } from '../game/MapPainter';
import { RaidSession } from '../game/RaidSession';
import { LocalLink, NetLink } from '../net/links';
import { NetClient } from '../net/NetClient';
import type { P2PHost } from '../net/p2p';
import { wsSocket } from '../net/sockets';
import { type Settings, isTouchDevice, saveSettings } from '../settings';
import { saveProfile } from '../storage';
import { clear, h, modal, toast } from './dom';
import { hideoutScreen, type HideoutTab } from './screens/hideout';
import { lobbyScreen } from './screens/lobby';
import { menuScreen } from './screens/menu';
import { raidPrepScreen } from './screens/raidprep';
import { resultsScreen } from './screens/results';
import { settingsScreen } from './screens/settings';

export class App {
  readonly ui: HTMLElement;
  private current: HTMLElement | null = null;
  net: NetClient | null = null;
  p2pHost: P2PHost | null = null;
  session: RaidSession | null = null;
  /** Aus einem Einladungslink (#join=CODE) */
  pendingJoin: { code: string; mode: 'p2p' | 'server' } | null = null;
  coopMode: 'p2p' | 'server' | null = null;
  private serverAvailable: boolean | null = null;
  private overviewCache = new Map<string, HTMLCanvasElement>();

  constructor(
    readonly canvas: HTMLCanvasElement,
    ui: HTMLElement,
    public settings: Settings,
    public profile: Profile,
  ) {
    this.ui = ui;
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    if (profile.activeRaid) {
      abandonRaid(profile);
      this.save();
      setTimeout(
        () =>
          modal(
            h(
              'div',
              { style: { maxWidth: '380px' } },
              h('h2', null, 'Raid abgebrochen'),
              h('p', null, 'Dein letzter Raid wurde nicht ordnungsgemäß beendet (Seite neu geladen oder Verbindung verloren). Du giltst als vermisst – deine Ausrüstung ist verloren, der Inhalt des sicheren Behälters bleibt erhalten.'),
            ),
          ),
        300,
      );
    }
  }

  save() {
    saveProfile(this.profile);
  }
  saveSettings() {
    saveSettings(this.settings);
    audio.setVolume(this.settings.volume);
  }

  get touch() {
    return isTouchDevice(this.settings);
  }

  show(el: HTMLElement) {
    if (this.current) this.current.remove();
    this.current = el;
    this.ui.appendChild(el);
  }

  clearScreen() {
    if (this.current) this.current.remove();
    this.current = null;
  }

  // ---- Navigation ----
  goMenu() {
    this.show(menuScreen(this));
  }
  goHideout(tab: HideoutTab = 'gear') {
    // Ausrüstung darf sich nach "Bereit" nicht mehr ändern – sonst passt das gemeldete Kit nicht
    const net = this.net;
    const me = net?.lobby?.players.find((p) => p.id === net.id);
    if (net && me?.ready && !net.lobby?.raidActive) {
      net.send({ type: 'ready', ready: false });
      toast('Bereit-Status aufgehoben – nach Änderungen erneut „Bereit“ drücken.', 'info', 3500);
    }
    this.show(hideoutScreen(this, tab));
  }
  goRaidPrep() {
    this.show(raidPrepScreen(this));
  }
  goSettings() {
    this.show(settingsScreen(this));
  }
  goLobby() {
    this.show(lobbyScreen(this));
  }
  goResults(report: RaidReport, result: RaidResult, coop: boolean) {
    this.show(resultsScreen(this, report, result, coop));
  }

  /** Übersichtskarte für Vorschauen */
  overview(mapId: string): HTMLCanvasElement {
    let c = this.overviewCache.get(mapId);
    if (!c) {
      c = new MapPainter(buildMap(mapId)).overviewCanvas();
      this.overviewCache.set(mapId, c);
    }
    return c;
  }

  private attachNet(net: NetClient) {
    // Coop-Raid starten, sobald der Host ihn ankündigt
    net.onRaid((m) => {
      if (this.session || m.type !== 'raidStart' || this.net !== net) return;
      this.startCoop(net, [m]);
    });
    this.net = net;
    return net;
  }

  /** Verbindung zu einem Node-Coop-Server. */
  ensureServerNet(url: string): NetClient {
    if (this.net && this.net.key === url) return this.net;
    this.leaveNet();
    return this.attachNet(new NetClient(url, () => wsSocket(url), 'server'));
  }

  /** P2P: eigene Lobby im Browser hosten. */
  async hostP2P(): Promise<NetClient> {
    this.leaveNet();
    const { P2PHost } = await import('../net/p2p');
    const host = await P2PHost.create();
    this.p2pHost = host;
    this.watchUnload();
    const net = this.attachNet(new NetClient('p2p-host-' + host.code, () => host.localSocket(), 'p2p-host'));
    await net.connect(this.profile.name);
    net.send({ type: 'create', name: this.profile.name, code: host.code });
    return net;
  }

  /** P2P: einer Lobby per Code beitreten. */
  async joinP2P(code: string): Promise<NetClient> {
    code = code.trim().toUpperCase();
    const key = 'p2p-guest-' + code;
    if (this.net && this.net.key === key && this.net.state === 'open') return this.net;
    this.leaveNet();
    const { guestSocketFactory } = await import('../net/p2p');
    const net = this.attachNet(new NetClient(key, guestSocketFactory(code), 'p2p-guest'));
    try {
      await net.connect(this.profile.name);
    } catch (e) {
      if (this.net === net) this.net = null;
      throw e;
    }
    net.send({ type: 'join', code, name: this.profile.name });
    return net;
  }

  private unloadBound = false;
  /** Host schließt den Tab: Gäste sofort benachrichtigen bzw. vorher nachfragen. */
  private watchUnload() {
    if (this.unloadBound) return;
    this.unloadBound = true;
    window.addEventListener('beforeunload', (e) => {
      if (this.p2pHost && this.p2pHost.guests > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    window.addEventListener('pagehide', () => this.p2pHost?.destroy());
  }

  /** Coop-Verbindung (und ggf. die eigene P2P-Lobby) beenden. */
  leaveNet() {
    this.net?.close();
    this.net = null;
    this.p2pHost?.destroy();
    this.p2pHost = null;
  }

  /** Einladungslink für eine Lobby. */
  inviteUrl(code: string, mode: 'p2p' | 'server') {
    return `${location.origin}${location.pathname}${location.search}#join=${code}${mode === 'server' ? '&mode=server' : ''}`;
  }

  /** Läuft ein Node-Coop-Server unter derselben Adresse? (auf GitHub Pages: nein) */
  async detectServer(): Promise<boolean> {
    if (this.serverAvailable !== null) return this.serverAvailable;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      // statisch (GitHub Pages): {"server": false} – der Node-Server antwortet mit {"server": true}
      const res = await fetch('./server-info.json', { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      const j = res.ok ? await res.json() : null;
      this.serverAvailable = j?.server === true;
    } catch {
      this.serverAvailable = false;
    }
    return this.serverAvailable;
  }

  // ---- Raids ----
  startSolo(mapId: string, difficulty: number, scav = false) {
    const p = this.profile;
    const kit = beginRaid(p, mapId, false, scav);
    this.save();
    const link = new LocalLink(
      { mapId, seed: (Math.random() * 2 ** 31) | 0, difficulty, players: 1, friendlyFire: false },
      { name: p.name, inv: kit, level: profileLevel(p), color: scav ? '#8a7a55' : p.color, regen: scav ? 0 : regenRate(p), scav },
    );
    this.runSession(link, false, scav);
  }

  /** Coop-Raid starten, sobald der Server raidStart schickt. */
  startCoop(net: NetClient, buffered: HostMsg[]) {
    const p = this.profile;
    const mapId = buffered.find((m): m is Extract<HostMsg, { type: 'raidStart' }> => m.type === 'raidStart')?.info.mapId ?? 'grenzstadt';
    beginRaid(p, mapId, true);
    this.save();
    const link = new NetLink(net);
    link.prime(buffered);
    this.runSession(link, true);
  }

  private runSession(link: LocalLink | NetLink, coop: boolean, scav = false) {
    this.clearScreen();
    clear(this.ui);
    this.session = new RaidSession({
      canvas: this.canvas,
      ui: this.ui,
      settings: this.settings,
      touch: this.touch,
      link,
      name: this.profile.name,
      color: scav ? '#8a7a55' : this.profile.color,
      firstRaid: this.profile.stats.raids < 2,
      onFinish: (r) => {
        this.session = null;
        const report = applyRaidResult(this.profile, r);
        this.save();
        if (report.levelAfter > report.levelBefore) audio.ui('level');
        this.goResults(report, r, coop);
      },
      onAbandon: () => {
        this.session = null;
        if (coop) this.net?.send({ type: 'leave' });
        abandonRaid(this.profile);
        this.save();
        this.goHideout();
      },
    });
  }

  mapName(id: string) {
    return mapMeta(id).name;
  }
}
