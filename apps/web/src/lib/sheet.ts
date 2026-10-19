// Feed settings sheet: open/close state, layout and keyboard handling, kept pure so
// the behaviour is testable without a DOM. Mobile gets a full-height bottom sheet
// that slides up; wider screens get a side drawer.

export type SheetLayout = "bottom" | "drawer";

/** Same breakpoint as the stylesheet's single-column layout. */
export const SHEET_BREAKPOINT = 860;

export function sheetLayout(viewportWidth: number): SheetLayout {
  return viewportWidth < SHEET_BREAKPOINT ? "bottom" : "drawer";
}

export const SHEET_SECTIONS = ["recipe", "view", "filters", "more"] as const;
export type SheetSection = (typeof SHEET_SECTIONS)[number];

export interface SheetState {
  open: boolean;
  /** Section to scroll to when opened (e.g. the recipe pill opens "recipe"). */
  section: SheetSection;
  /** Element id to give focus back to on close. */
  returnFocus?: string;
}

export type SheetAction =
  | { type: "open"; section?: SheetSection; from?: string }
  | { type: "close" }
  | { type: "toggle"; from?: string }
  | { type: "key"; key: string };

export const closedSheet: SheetState = { open: false, section: "recipe" };

export function sheetReduce(s: SheetState, a: SheetAction): SheetState {
  switch (a.type) {
    case "open":
      return { open: true, section: a.section ?? "recipe", returnFocus: a.from ?? s.returnFocus };
    case "close":
      return s.open ? { ...s, open: false } : s;
    case "toggle":
      return s.open ? { ...s, open: false } : { open: true, section: s.section, returnFocus: a.from };
    case "key":
      return a.key === "Escape" && s.open ? { ...s, open: false } : s;
  }
}

/**
 * Focus trap helper: given the index of the focused element among the sheet's
 * focusable elements, where Tab / Shift+Tab should go.
 */
export function trapFocus(index: number, count: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (index < 0) return shift ? count - 1 : 0;
  return shift ? (index - 1 + count) % count : (index + 1) % count;
}

/** Comma- or newline-separated text to a clean, lowercased, de-duplicated list. */
export function splitList(text: string, max = 64): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const t = raw.trim().replace(/^#/, "").toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, max);
}

/** Duration filter choices offered in the sheet (seconds; null = any). */
export const DURATION_CHOICES: { id: string; label: string; min: number; max: number | null }[] = [
  { id: "any", label: "Any length", min: 0, max: null },
  { id: "short", label: "Under 3 min", min: 0, max: 180 },
  { id: "under20", label: "Under 20 min", min: 0, max: 1200 },
  { id: "over5", label: "Over 5 min", min: 300, max: null },
  { id: "over20", label: "Over 20 min", min: 1200, max: null },
];

export function durationChoice(min: number, max: number | null): string {
  return DURATION_CHOICES.find((c) => c.min === min && c.max === max)?.id ?? "custom";
}
