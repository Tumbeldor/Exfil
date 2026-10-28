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

function start(app: App) {
  (window as unknown as { __app: App }).__app = app;
  app.goMenu();
}

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
    h('div', { class: 'title' }, h('div', { class: 't1' }, 'EXTRACTION'), h('div', { class: 't1', style: { fontSize: 'clamp(26px,5vw,46px)', color: '#cfd6c8' } }, 'LOOTER'), h('div', { class: 't2' }, 'Sperrzone')),
    h(
      'div',
      { class: 'panel col gap', style: { padding: '18px', maxWidth: '380px', alignItems: 'stretch' } },
      h('p', { class: 'center', style: { margin: '0' } }, 'Willkommen, Operator. Du startest mit einer Pistole, einer Pumpflinte und etwas Geld. Der Rest liegt in der Zone.'),
      input,
      h('button', { class: 'btn primary big', onclick: go }, 'Los geht’s'),
    ),
  );
  ui.appendChild(screen);
  setTimeout(() => input.focus(), 50);
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
