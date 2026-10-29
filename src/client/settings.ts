import { readStored } from './storage';

export interface Settings {
  volume: number;
  aimAssist: boolean;
  touchAutoFire: boolean;
  autoReload: boolean;
  zoom: number;
  quality: 'low' | 'high';
  showFps: boolean;
  minimap: boolean;
  vibrate: boolean;
  difficulty: number;
  serverUrl: string;
  stickSize: number;
  /** Empfindlichkeit der Touch-Sticks (1 = normal) */
  stickSens: number;
  forceTouch: 'auto' | 'on' | 'off';
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.7,
  aimAssist: true,
  touchAutoFire: true,
  autoReload: true,
  zoom: 1,
  quality: 'high',
  showFps: false,
  minimap: true,
  vibrate: true,
  difficulty: 1,
  serverUrl: '',
  stickSize: 1,
  stickSens: 1,
  forceTouch: 'auto',
};

const KEY = 'exfil.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = readStored(KEY, 'xl.settings.v1');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* privater Modus o. ä. */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignorieren */
  }
}

export function isTouchDevice(s: Settings): boolean {
  if (s.forceTouch === 'on') return true;
  if (s.forceTouch === 'off') return false;
  return typeof window !== 'undefined' && (('ontouchstart' in window && navigator.maxTouchPoints > 0) || matchMedia('(pointer: coarse)').matches);
}
