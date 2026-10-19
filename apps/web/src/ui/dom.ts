// Minimal DOM builder. Text always goes in as text nodes, never as HTML, so
// titles and list names from the network can't inject markup.

export type Child = Node | string | number | null | undefined | false | Child[];
type Handler = (ev: Event) => void;
export type Props = Record<string, unknown> & { class?: string; style?: Record<string, string> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "style") for (const [sk, sv] of Object.entries(v as Record<string, string>)) el.style.setProperty(sk, sv);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as Handler);
      else if (k === "value" || k === "checked" || k === "disabled" || k === "hidden" || k === "selected") (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
}

let uid = 0;
export const nextId = (p: string) => `${p}-${++uid}`;

/** A labelled checkbox row in the mockup's `.switch` style. */
export function toggle(id: string, label: string, checked: boolean, onChange: (on: boolean) => void, opts: { disabled?: boolean; hint?: string } = {}): HTMLElement[] {
  const input = h("input", { type: "checkbox", id, checked, disabled: opts.disabled, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) });
  if (opts.hint) input.setAttribute("aria-describedby", id + "-hint");
  return [
    h("div", { class: "switch" + (opts.disabled ? " is-off" : "") }, h("label", { for: id }, label), input),
    opts.hint ? h("p", { class: "hint", id: id + "-hint" }, opts.hint) : null,
  ].filter(Boolean) as HTMLElement[];
}
