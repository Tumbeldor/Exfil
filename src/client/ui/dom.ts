type Attrs = Record<string, unknown> & { class?: string; style?: string | Partial<CSSStyleDeclaration> };
type Child = Node | string | number | null | undefined | false | Child[];

/** Kleiner Hyperscript-Helfer für DOM-Aufbau ohne Framework. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'html') {
        el.innerHTML = String(v);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function svgEl(markup: string, cls = ''): HTMLElement {
  const span = document.createElement('span');
  span.className = 'svgicon ' + cls;
  span.innerHTML = markup;
  return span;
}

let toastHost: HTMLElement | null = null;
export function toast(text: string, kind: 'info' | 'good' | 'warn' | 'bad' = 'info', ms = 2600) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts' });
    document.body.appendChild(toastHost);
  }
  const t = h('div', { class: 'toast ' + kind }, text);
  toastHost.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/** Modaler Dialog. Gibt eine Funktion zum Schließen zurück. */
export function modal(content: HTMLElement, opts: { onClose?: () => void; cls?: string; closable?: boolean } = {}): () => void {
  const back = h('div', { class: 'modal-back ' + (opts.cls ?? '') });
  const box = h('div', { class: 'modal' }, content);
  back.appendChild(box);
  const close = () => {
    back.remove();
    opts.onClose?.();
  };
  if (opts.closable !== false) {
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) close();
    });
    box.appendChild(h('button', { class: 'modal-x', onclick: close, 'aria-label': 'Schließen' }, '✕'));
  }
  document.body.appendChild(back);
  return close;
}

export function confirmDialog(text: string, yes = 'Ja', no = 'Abbrechen'): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      close();
      resolve(v);
    };
    const close = modal(
      h('div', { class: 'confirm' }, h('p', null, text), h('div', { class: 'row gap' }, h('button', { class: 'btn', onclick: () => finish(false) }, no), h('button', { class: 'btn primary', onclick: () => finish(true) }, yes))),
      { onClose: () => finish(false) },
    );
  });
}
