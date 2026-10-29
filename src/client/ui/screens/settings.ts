import { DEFAULT_SETTINGS, type Settings } from '../../settings';
import type { App } from '../App';
import { clear, h, toast } from '../dom';

export function settingsScreen(app: App): HTMLElement {
  const root = h('div', { class: 'screen' });
  const render = () => {
    clear(root);
    const s = app.settings;
    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
      s[k] = v;
      app.saveSettings();
      render();
    };
    const sw = (k: keyof Settings, label: string, desc: string) =>
      h('div', { class: 'setting' }, h('div', null, h('div', null, label), h('div', { class: 'd' }, desc)), h('div', { class: 'switch' + (s[k] ? ' on' : ''), onclick: () => set(k, !s[k] as never) }));
    const chips = <K extends keyof Settings>(k: K, label: string, desc: string, opts: [Settings[K], string][]) =>
      h(
        'div',
        { class: 'setting' },
        h('div', null, h('div', null, label), h('div', { class: 'd' }, desc)),
        h('div', { class: 'filter-chips' }, opts.map(([v, l]) => h('div', { class: 'chip' + (s[k] === v ? ' active' : ''), onclick: () => set(k, v) }, l))),
      );
    const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.volume) }) as HTMLInputElement;
    vol.addEventListener('change', () => set('volume', Number(vol.value)));
    const srv = h('input', { value: s.serverUrl, placeholder: 'leer = diese Seite', style: { width: '220px' } }) as HTMLInputElement;
    srv.addEventListener('change', () => set('serverUrl', srv.value.trim()));
    root.append(
      h('div', { class: 'topbar' }, h('button', { class: 'btn small', onclick: () => app.goMenu() }, '← Menü'), h('h2', null, 'Einstellungen')),
      h(
        'div',
        { class: 'tab-body scroll', style: { display: 'block', borderRadius: '8px' } },
        h('div', { style: { maxWidth: '720px', margin: '0 auto' } },
          h('div', { class: 'setting' }, h('div', null, h('div', null, 'Lautstärke'), h('div', { class: 'd' }, 'Alle Effekte werden live erzeugt.')), vol),
          chips('forceTouch', 'Touch-Steuerung', 'Automatisch erkennen oder erzwingen.', [['auto', 'Auto'], ['on', 'An'], ['off', 'Aus']]),
          sw('touchAutoFire', 'Feuern per Zielstick', 'Rechten Stick weit auslenken = schießen. Aus: eigener Feuerknopf.'),
          sw('aimAssist', 'Zielhilfe (Touch/Gamepad)', 'Zielt leicht auf sichtbare Gegner in Blickrichtung.'),
          chips('stickSize', 'Stick-Größe', 'Größe der virtuellen Sticks.', [[0.85, 'Klein'], [1, 'Normal'], [1.2, 'Groß']]),
          chips('stickSens', 'Stick-Empfindlichkeit', 'Wie stark die Sticks auf kleine Daumenbewegungen reagieren.', [[0.75, 'Niedrig'], [1, 'Normal'], [1.3, 'Hoch']]),
          sw('vibrate', 'Vibration', 'Haptisches Feedback (wo unterstützt).'),
          sw('autoReload', 'Automatisch nachladen', 'Bei leerem Magazin beim Abdrücken nachladen.'),
          chips('zoom', 'Kamera-Zoom', 'Wie viel von der Umgebung sichtbar ist.', [[1.2, 'Nah'], [1, 'Normal'], [0.82, 'Weit']]),
          chips('quality', 'Grafikqualität', 'Niedrig für ältere Geräte (weniger Partikel, geringere Auflösung).', [['high', 'Hoch'], ['low', 'Niedrig']]),
          sw('minimap', 'Minikarte', 'Kleine Karte oben rechts anzeigen.'),
          h('div', { class: 'setting' }, h('div', null, h('div', null, 'Coop-Server'), h('div', { class: 'd' }, 'Adresse eines eigenen Servers, z. B. 192.168.0.10:3000')), srv),
          h('div', { class: 'row gap', style: { marginTop: '14px' } }, h('button', { class: 'btn small', onclick: () => {
            app.settings = { ...DEFAULT_SETTINGS };
            app.saveSettings();
            toast('Standardwerte wiederhergestellt', 'good');
            render();
          } }, 'Standard wiederherstellen')),
        ),
      ),
    );
  };
  render();
  return root;
}
