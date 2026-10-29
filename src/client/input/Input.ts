import { lerpAngle } from '../../shared/math';
import type { Settings } from '../settings';
import { h, svgEl } from '../ui/dom';
import { iconSvg } from '../ui/icons';

export type InputAction =
  | 'reload'
  | 'swap'
  | 'slot1'
  | 'slot2'
  | 'interact'
  | 'inventory'
  | 'map'
  | 'heal'
  | 'bandage'
  | 'stim'
  | 'grenade'
  | 'ping'
  | 'pause'
  | 'extracts'
  | 'cancel'
  | 'escape';

export interface InputFrame {
  moveX: number;
  moveY: number;
  /** Weltwinkel, null = unverändert */
  aim: number | null;
  /** Wurfweite in Welteinheiten */
  aimDist: number;
  aimActive: boolean;
  fire: boolean;
  firePressed: boolean;
  ads: boolean;
  sprint: boolean;
  actions: InputAction[];
  /** Zielpunkt in Welt (Maus) */
  aimWorld: { x: number; y: number } | null;
}

interface StickState {
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
  el: HTMLElement;
  knob: HTMLElement;
}

/** Daumenweg in px bis zum Vollausschlag (Stick-Größe Normal, Empfindlichkeit Normal). */
const STICK_TRAVEL = 72;
/** Sichtbarer Weg des Knopfes im Ring (unskaliert). */
const KNOB_TRAVEL = 56;
const MOVE_DEADZONE = 0.15;
const AIM_DEADZONE = 0.2;

const KEYMAP: Record<string, InputAction> = {
  KeyR: 'reload',
  KeyQ: 'swap',
  Digit1: 'slot1',
  Digit2: 'slot2',
  KeyE: 'interact',
  KeyF: 'interact',
  Tab: 'inventory',
  KeyI: 'inventory',
  KeyM: 'map',
  KeyH: 'heal',
  Digit5: 'heal',
  Digit4: 'bandage',
  Digit6: 'stim',
  KeyG: 'grenade',
  KeyZ: 'ping',
  KeyP: 'pause',
  KeyO: 'extracts',
  KeyX: 'cancel',
  Escape: 'escape',
};

/** Vereinheitlichte Eingabe aus Tastatur/Maus, Touch und Gamepad. */
export class Input {
  private keys = new Set<string>();
  private queued: InputAction[] = [];
  private mouse = { x: 0, y: 0, inside: false, left: false, right: false, pressed: false };
  private playerScreen = { x: 0, y: 0, zoom: 1 };
  private camWorld = { x: 0, y: 0 };
  private lastAim: number | null = null;
  /** geglätteter Zielwinkel des Touch-Zielsticks */
  private touchAim: number | null = null;
  private lastPollT = 0;
  touchMode: boolean;
  private touchRoot: HTMLElement | null = null;
  private moveStick: StickState | null = null;
  private aimStick: StickState | null = null;
  private fireBtnHeld = false;
  private adsToggle = false;
  private sprintToggle = false;
  private buttons = new Map<string, HTMLElement>();
  private interactBtn: HTMLElement | null = null;
  private padPrev: boolean[] = [];
  private usingPad = false;
  private disposers: (() => void)[] = [];
  /** Blockiert Spieleingaben (z. B. bei geöffnetem Inventar) */
  blocked = false;
  onInteractTap?: () => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private uiRoot: HTMLElement,
    private settings: Settings,
    touch: boolean,
  ) {
    this.touchMode = touch;
    this.bindKeyboardMouse();
    if (touch) this.buildTouchUi();
  }

  private on<K extends keyof WindowEventMap>(t: Window, ev: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void;
  private on<K extends keyof HTMLElementEventMap>(t: HTMLElement, ev: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void;
  private on(t: Window | HTMLElement, ev: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) {
    t.addEventListener(ev, fn, opts);
    this.disposers.push(() => t.removeEventListener(ev, fn, opts));
  }

  dispose() {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.touchRoot?.remove();
  }

  private bindKeyboardMouse() {
    this.on(window, 'keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const act = KEYMAP[e.code];
      if (act) this.queued.push(act);
      this.usingPad = false;
    });
    this.on(window, 'keyup', (e) => this.keys.delete(e.code));
    this.on(window, 'blur', () => {
      this.keys.clear();
      this.mouse.left = false;
      this.mouse.right = false;
    });
    this.on(this.canvas, 'pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.inside = true;
      this.usingPad = false;
    });
    this.on(this.canvas, 'pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (e.button === 0) {
        this.mouse.left = true;
        this.mouse.pressed = true;
      } else if (e.button === 2) this.mouse.right = true;
      else if (e.button === 1) {
        e.preventDefault();
        this.queued.push('ping');
      }
      this.canvas.setPointerCapture?.(e.pointerId);
    });
    this.on(window, 'pointerup', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    this.on(this.canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(
      this.canvas,
      'wheel',
      (e) => {
        e.preventDefault();
        if (Math.abs(e.deltaY) > 4) this.queued.push('swap');
      },
      { passive: false },
    );
  }

  // ---------------- Touch ----------------
  private buildTouchUi() {
    const root = h('div', { class: 'touch-ui' });
    this.touchRoot = root;
    this.uiRoot.appendChild(root);
    const sz = this.settings.stickSize;
    const mkBtn = (id: string, icon: string, style: Partial<CSSStyleDeclaration>, act: () => void, small = false, hold?: (down: boolean) => void) => {
      const b = h('div', { class: 'tbtn' + (small ? ' small' : ''), style }, svgEl(iconSvg(icon)));
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.classList.add('pressed');
        if (hold) hold(true);
        else act();
        this.vibrate(8);
      });
      const up = (e: PointerEvent) => {
        e.stopPropagation();
        b.classList.remove('pressed');
        if (hold) hold(false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', (e) => {
        if (hold && b.classList.contains('pressed')) up(e);
      });
      root.appendChild(b);
      this.buttons.set(id, b);
      return b;
    };
    const R = (r: number, bt: number) => ({ right: `calc(${r}px + var(--sar))`, bottom: `calc(${bt}px + var(--sab))` });
    const TR = (r: number, t: number) => ({ right: `calc(${r}px + var(--sar))`, top: `calc(${t}px + var(--sat))` });
    mkBtn('reload', 'reload', R(16, 92), () => this.queued.push('reload'));
    mkBtn('ads', 'scope', R(16, 160), () => {
      this.adsToggle = !this.adsToggle;
      this.buttons.get('ads')!.classList.toggle('on', this.adsToggle);
    });
    mkBtn('swap', 'swap', R(20, 228), () => this.queued.push('swap'), true);
    mkBtn('heal', 'heal', R(88, 16), () => this.queued.push('heal'));
    mkBtn('grenade', 'grenade', R(156, 16), () => this.queued.push('grenade'), true);
    mkBtn('sprint', 'sprint', { left: `calc(16px + var(--sal))`, bottom: `calc(16px + var(--sab))` }, () => {
      this.sprintToggle = !this.sprintToggle;
      this.buttons.get('sprint')!.classList.toggle('on', this.sprintToggle);
    }, true);
    if (!this.settings.touchAutoFire) {
      mkBtn('fire', 'w_ar', R(88, 92), () => {}, false, (d) => (this.fireBtnHeld = d));
      this.buttons.get('fire')!.style.cssText += ';width:72px;height:72px;border-color:rgba(224,87,79,.6)';
    }
    mkBtn('pause', 'pause', TR(8, 8), () => this.queued.push('pause'), true);
    mkBtn('inventory', 'bag', TR(60, 8), () => this.queued.push('inventory'), true);
    mkBtn('map', 'map', TR(112, 8), () => this.queued.push('map'), true);
    mkBtn('ping', 'ping', TR(164, 8), () => this.queued.push('ping'), true);

    const ib = h('div', { class: 'interact hidden', style: { left: '50%', transform: 'translateX(-50%)', bottom: `calc(${66}px + var(--sab))` } }, svgEl(iconSvg('hand')), h('span', null, 'Benutzen'));
    ib.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.queued.push('interact');
      this.vibrate(10);
    });
    root.appendChild(ib);
    this.interactBtn = ib;

    const mkStick = (fire: boolean) => {
      const el = h('div', { class: 'stick ghost' + (fire ? ' fire' : '') });
      el.style.transform = `scale(${sz})`;
      const knob = h('div', { class: 'knob' });
      el.appendChild(knob);
      root.appendChild(el);
      return { el, knob };
    };
    const moveEls = mkStick(false);
    const aimEls = mkStick(this.settings.touchAutoFire);
    const placeGhost = () => {
      const w = window.innerWidth;
      const hh = window.innerHeight;
      if (!this.moveStick) {
        moveEls.el.style.left = 120 + 'px';
        moveEls.el.style.top = hh - 120 + 'px';
      }
      if (!this.aimStick) {
        aimEls.el.style.left = w - 230 + 'px';
        aimEls.el.style.top = hh - 150 + 'px';
      }
    };
    placeGhost();
    this.on(window, 'resize', placeGhost);

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || this.blocked) return;
      e.preventDefault();
      const left = e.clientX < window.innerWidth * 0.45;
      const st: StickState = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, ...(left ? moveEls : aimEls) };
      if (left && !this.moveStick) this.moveStick = st;
      else if (!left && !this.aimStick) this.aimStick = st;
      else return;
      st.el.classList.remove('ghost');
      st.el.style.left = st.ox + 'px';
      st.el.style.top = st.oy + 'px';
      st.knob.style.transform = '';
    };
    const move = (e: PointerEvent) => {
      for (const st of [this.moveStick, this.aimStick]) {
        if (!st || st.id !== e.pointerId) continue;
        e.preventDefault();
        st.x = e.clientX;
        st.y = e.clientY;
        let dx = st.x - st.ox;
        let dy = st.y - st.oy;
        const d = Math.hypot(dx, dy);
        const r = this.stickRadius();
        // Basis folgt dem Finger, wenn weit außerhalb
        if (d > r * 1.9) {
          const k = (d - r * 1.9) / d;
          st.ox += dx * k;
          st.oy += dy * k;
          st.el.style.left = st.ox + 'px';
          st.el.style.top = st.oy + 'px';
          dx = st.x - st.ox;
          dy = st.y - st.oy;
        }
        const dd = Math.hypot(dx, dy) || 1;
        const kk = (Math.min(1, dd / r) * KNOB_TRAVEL) / dd;
        st.knob.style.transform = `translate(${dx * kk}px, ${dy * kk}px)`;
      }
    };
    const up = (e: PointerEvent) => {
      if (this.moveStick?.id === e.pointerId) {
        this.moveStick.el.classList.add('ghost');
        this.moveStick.knob.style.transform = '';
        this.moveStick = null;
        placeGhost();
      }
      if (this.aimStick?.id === e.pointerId) {
        this.aimStick.el.classList.add('ghost');
        this.aimStick.knob.style.transform = '';
        this.aimStick = null;
        this.touchAim = null;
        placeGhost();
      }
    };
    this.on(this.canvas, 'pointerdown', down);
    this.on(window, 'pointermove', move, { passive: false });
    this.on(window, 'pointerup', up);
    this.on(window, 'pointercancel', up);
  }

  /** Weg bis Vollausschlag: größerer Stick und niedrigere Empfindlichkeit brauchen mehr Daumenweg. */
  private stickRadius() {
    return (STICK_TRAVEL * this.settings.stickSize) / (this.settings.stickSens || 1);
  }

  private stickVec(st: StickState | null): { x: number; y: number; m: number; over: number } {
    if (!st) return { x: 0, y: 0, m: 0, over: 0 };
    const dx = st.x - st.ox;
    const dy = st.y - st.oy;
    const d = Math.hypot(dx, dy);
    const r = this.stickRadius();
    const m = Math.min(1, d / r);
    if (d < 1e-3) return { x: 0, y: 0, m: 0, over: 0 };
    return { x: (dx / d) * m, y: (dy / d) * m, m, over: d / r };
  }

  setInteract(label: string | null) {
    if (!this.interactBtn) return;
    if (!label) this.interactBtn.classList.add('hidden');
    else {
      this.interactBtn.classList.remove('hidden');
      (this.interactBtn.lastChild as HTMLElement).textContent = label;
    }
  }

  setButtonCount(id: string, n: number | null) {
    const b = this.buttons.get(id);
    if (!b) return;
    let c = b.querySelector('.cnt') as HTMLElement | null;
    if (n === null) {
      c?.remove();
      return;
    }
    if (!c) {
      c = h('span', { class: 'cnt' });
      b.appendChild(c);
    }
    c.textContent = String(n);
    b.style.opacity = n > 0 ? '1' : '0.45';
  }

  resetToggles() {
    this.adsToggle = false;
    this.sprintToggle = false;
    this.buttons.get('ads')?.classList.remove('on');
    this.buttons.get('sprint')?.classList.remove('on');
  }

  vibrate(ms: number) {
    if (this.settings.vibrate && 'vibrate' in navigator) {
      try {
        navigator.vibrate(ms);
      } catch {
        /* nicht unterstützt */
      }
    }
  }

  setTouchVisible(v: boolean) {
    if (this.touchRoot) this.touchRoot.style.display = v ? '' : 'none';
  }

  /** Vom Renderer: Bildschirmposition des Spielers und Kamera-Info. */
  setView(px: number, py: number, zoom: number, camX: number, camY: number) {
    this.playerScreen = { x: px, y: py, zoom };
    this.camWorld = { x: camX, y: camY };
  }

  /** Mausposition relativ zur Bildschirmmitte (für Kamera-Vorschau). */
  mouseOffset(): { x: number; y: number } | null {
    if (this.touchMode || this.usingPad || !this.mouse.inside) return null;
    return { x: this.mouse.x - window.innerWidth / 2, y: this.mouse.y - window.innerHeight / 2 };
  }

  /** @param curAim aktuelle Blickrichtung der Figur (Startwert für den Touch-Zielstick) */
  poll(curAim?: number): InputFrame {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - this.lastPollT) / 1000));
    this.lastPollT = now;
    const f: InputFrame = {
      moveX: 0,
      moveY: 0,
      aim: null,
      aimDist: 300,
      aimActive: false,
      fire: false,
      firePressed: false,
      ads: false,
      sprint: false,
      actions: this.queued,
      aimWorld: null,
    };
    this.queued = [];
    // Tastatur
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) f.moveY -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f.moveY += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) f.moveX -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) f.moveX += 1;
    f.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    if (!this.touchMode && this.mouse.inside && !this.usingPad) {
      const dx = this.mouse.x - this.playerScreen.x;
      const dy = this.mouse.y - this.playerScreen.y;
      f.aim = Math.atan2(dy, dx);
      f.aimDist = Math.hypot(dx, dy) / this.playerScreen.zoom;
      f.aimActive = true;
      f.fire = this.mouse.left;
      f.firePressed = this.mouse.pressed;
      f.ads = this.mouse.right;
      f.aimWorld = {
        x: this.camWorld.x + (this.mouse.x - window.innerWidth / 2) / this.playerScreen.zoom,
        y: this.camWorld.y + (this.mouse.y - window.innerHeight / 2) / this.playerScreen.zoom,
      };
    }
    this.mouse.pressed = false;
    if (k.has('Space')) {
      f.fire = true;
    }
    // Touch
    if (this.touchMode) {
      const mv = this.stickVec(this.moveStick);
      if (mv.m > MOVE_DEADZONE) {
        // weiche Kennlinie: kleine Ausschläge = langsames, genaues Gehen
        const t = (mv.m - MOVE_DEADZONE) / (1 - MOVE_DEADZONE);
        const k = (0.08 + 0.92 * Math.pow(t, 1.35)) / mv.m;
        f.moveX = mv.x * k;
        f.moveY = mv.y * k;
        if (mv.over > 1.4) f.sprint = true;
      }
      if (this.sprintToggle && mv.m > MOVE_DEADZONE) f.sprint = true;
      const av = this.stickVec(this.aimStick);
      if (this.aimStick && av.m > AIM_DEADZONE) {
        // Blickrichtung dreht zum Stick hin statt zu springen; kleine Ausschläge und Zielfernrohr drehen langsamer
        const target = Math.atan2(av.y, av.x);
        const from = this.touchAim ?? curAim ?? this.lastAim ?? target;
        const rate = 15 * (this.settings.stickSens || 1) * (0.45 + 0.55 * av.m) * (this.adsToggle ? 0.6 : 1);
        this.touchAim = lerpAngle(from, target, 1 - Math.exp(-rate * dt));
        f.aim = this.touchAim;
        f.aimActive = true;
        f.aimDist = 120 + av.m * 300;
        if (this.settings.touchAutoFire && av.m > 0.7) {
          f.fire = true;
        }
      } else if (this.lastAim !== null && this.aimStick) {
        f.aim = this.lastAim;
      }
      if (this.fireBtnHeld) f.fire = true;
      f.ads = this.adsToggle;
    }
    // Gamepad
    this.pollPad(f);
    if (f.aim !== null) this.lastAim = f.aim;
    const len = Math.hypot(f.moveX, f.moveY);
    if (len > 1) {
      f.moveX /= len;
      f.moveY /= len;
    }
    if (this.blocked) {
      f.fire = false;
      f.firePressed = false;
      if (this.touchMode) {
        f.moveX = 0;
        f.moveY = 0;
      }
    }
    return f;
  }

  private pollPad(f: InputFrame) {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) return;
    const ax = pad.axes;
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
    const lx = dz(ax[0] ?? 0);
    const ly = dz(ax[1] ?? 0);
    const rx = dz(ax[2] ?? 0);
    const ry = dz(ax[3] ?? 0);
    const b = (i: number) => !!pad.buttons[i]?.pressed;
    const edge = (i: number) => b(i) && !this.padPrev[i];
    const any = lx || ly || rx || ry || pad.buttons.some((x) => x.pressed);
    if (any) this.usingPad = true;
    if (!this.usingPad) return;
    if (lx || ly) {
      f.moveX = lx;
      f.moveY = ly;
    }
    if (b(10) || b(4)) f.sprint = true;
    if (Math.hypot(rx, ry) > 0.25) {
      f.aim = Math.atan2(ry, rx);
      f.aimActive = true;
      f.aimDist = 140 + Math.hypot(rx, ry) * 280;
    } else if (this.lastAim !== null) f.aim = this.lastAim;
    if ((pad.buttons[7]?.value ?? 0) > 0.4) f.fire = true;
    if ((pad.buttons[7]?.value ?? 0) > 0.4 && !this.padPrev[7]) f.firePressed = true;
    if ((pad.buttons[6]?.value ?? 0) > 0.4) f.ads = true;
    const map: [number, InputAction][] = [
      [0, 'interact'],
      [2, 'reload'],
      [3, 'swap'],
      [1, 'heal'],
      [5, 'grenade'],
      [9, 'pause'],
      [8, 'map'],
      [12, 'inventory'],
      [13, 'ping'],
      [14, 'extracts'],
    ];
    for (const [i, a] of map) if (edge(i)) f.actions.push(a);
    this.padPrev = pad.buttons.map((x, i) => (i === 7 || i === 6 ? x.value > 0.4 : x.pressed));
  }
}
