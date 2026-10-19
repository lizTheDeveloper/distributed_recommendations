// One accessible modal dialog for the small flows (report, block, hidden items,
// incoming links, NSFW confirmation, picks preview, onboarding): role="dialog",
// aria-modal, labelled by its heading, focus trapped inside, Escape and the scrim
// close it, focus returns to whatever opened it. Re-render by calling `update`.

import { h } from "./dom.ts";
import type { Child } from "./dom.ts";

export interface DialogHandle {
  /** Replace the body (keeps focus on the element with the same id, if any). */
  update(): void;
  close(): void;
  readonly el: HTMLElement;
}

export interface DialogOptions {
  id: string;
  title: string;
  /** Extra class on the dialog (`wide`, `sheetlike`). */
  className?: string;
  /** Builds the body; called on open and on every `update()`. */
  body: (d: DialogHandle) => Child[];
  /** Element id to focus first (default: the first focusable control). */
  initialFocus?: string;
  /** Element (or its id) to return focus to on close. */
  returnFocus?: HTMLElement | string | null;
  onClose?: () => void;
  /** Close on Escape and scrim click (default true). */
  dismissable?: boolean;
}

const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

const open = new Map<string, DialogHandle>();

export function openDialog(o: DialogOptions): DialogHandle {
  open.get(o.id)?.close();
  const prev = (typeof o.returnFocus === "string" ? document.getElementById(o.returnFocus) : o.returnFocus) ?? (document.activeElement as HTMLElement | null);
  const titleId = `${o.id}-title`;
  const content = h("div", { class: "dialog-body" });
  const closeBtn = h("button", { class: "iconbtn dialog-close", type: "button", "aria-label": "Close", onclick: () => handle.close() }, h("span", { "aria-hidden": "true" }, "×"));
  const dialog = h(
    "div",
    { class: "modal dialog" + (o.className ? " " + o.className : ""), role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, id: o.id },
    h("div", { class: "head" }, h("h2", { id: titleId }, o.title), o.dismissable === false ? null : closeBtn),
    content,
  );
  const scrim = h("div", { class: "scrim dialog-scrim", onclick: (e: Event) => e.target === scrim && o.dismissable !== false && handle.close() }, dialog);
  let closed = false;
  const handle: DialogHandle = {
    el: dialog,
    update() {
      const focusId = (document.activeElement as HTMLElement | null)?.id;
      content.replaceChildren();
      for (const c of o.body(handle).flat(Infinity as 1) as Child[]) if (c !== null && c !== undefined && c !== false) content.append(typeof c === "object" ? (c as Node) : String(c));
      if (focusId && dialog.contains(document.getElementById(focusId))) document.getElementById(focusId)?.focus({ preventScroll: true });
      else if (!dialog.contains(document.activeElement)) first()?.focus({ preventScroll: true });
    },
    close() {
      if (closed) return;
      closed = true;
      open.delete(o.id);
      scrim.remove();
      document.body.classList.toggle("dialog-open", open.size > 0);
      o.onClose?.();
      prev?.focus?.({ preventScroll: true });
    },
  };
  const first = () => (o.initialFocus ? document.getElementById(o.initialFocus) : null) ?? (content.querySelector(FOCUSABLE) as HTMLElement | null) ?? closeBtn;
  scrim.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape" && o.dismissable !== false) {
      e.preventDefault();
      e.stopPropagation();
      handle.close();
      return;
    }
    if (e.key !== "Tab") return;
    const els = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      els[els.length - 1].focus();
    } else if (!e.shiftKey && (i === els.length - 1 || i < 0)) {
      e.preventDefault();
      els[0].focus();
    }
  });
  document.body.appendChild(scrim);
  document.body.classList.add("dialog-open");
  open.set(o.id, handle);
  handle.update();
  first()?.focus({ preventScroll: true });
  return handle;
}

export function isDialogOpen(): boolean {
  return open.size > 0;
}
