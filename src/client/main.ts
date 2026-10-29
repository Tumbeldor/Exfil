import './ui/styles.css';
import { loadSettings } from './settings';
import { createProfile, loadProfile } from './storage';
import { App } from './ui/App';
import { h } from './ui/dom';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('app') as HTMLElement;
const settings = loadSettings();

// Doppeltipp-Zoom und Gesten auf iOS unterbinden
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// Einladungslink: …#join=CODE (P2P) bzw. #join=CODE&mode=server
function readInvite(): { code: string; mode: 'p2p' | 'server' } | null {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const code = (params.get('join') ?? '').toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return { code, mode: params.get('mode') === 'server' ? 'server' : 'p2p' };
}
const invite = readInvite();

function start(app: App) {
  (window as unknown as { __app: App }).__app = app;
  if (invite) {
    app.pendingJoin = invite;
    app.goLobby();
  } else app.goMenu();
}

window.addEventListener('hashchange', () => {
  const inv = readInvite();
  const app = (window as unknown as { __app?: App }).__app;
  if (inv && app && !app.session) {
    app.pendingJoin = inv;
    app.goLobby();
  }
});

const existing = loadProfile();
if (existing) {
  start(new App(canvas, ui, settings, existing));
} else {
  const input = h('input', { placeholder: 'Dein Name', maxlength: '16', style: { fontSize: '18px', textAlign: 'center' } }) as HTMLInputElement;
  const go = () => {
    const name = input.value.trim().slice(0, 16) || 'Operator';
    screen.remove();
    start(new App(canvas, ui, settings, createProfile(name)));
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });
  const screen = h(
    'div',
    { class: 'screen menu-screen' },
    h('div', { class: 'title' }, h('div', { class: 't1' }, 'EXTRACTION'), h('div', { class: 't1 t1b' }, 'LOOTER'), h('div', { class: 't2' }, 'Sperrzone')),
    h(
      'div',
      { class: 'panel col gap', style: { padding: '18px', maxWidth: '380px', alignItems: 'stretch' } },
      h('p', { class: 'center', style: { margin: '0' } }, 'Willkommen, Operator. Du startest mit einer Pistole, einer Pumpflinte und etwas Geld. Der Rest liegt in der Zone.'),
      invite ? h('p', { class: 'center accent', style: { margin: '0', fontWeight: '700' } }, `Du wurdest in eine Coop-Lobby eingeladen (Code ${invite.code}).`) : null,
      input,
      h('button', { class: 'btn primary big', onclick: go }, 'Los geht’s'),
    ),
  );
  ui.appendChild(screen);
  setTimeout(() => input.focus(), 50);
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
