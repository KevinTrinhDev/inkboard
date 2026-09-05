/**
 * Per-page board background: a paper tone plus an optional guide pattern.
 *
 * The choice lives in each page record's `meta` (which syncs between
 * devices like every other board record), and BoardCanvas paints it onto
 * tldraw's `.tl-background` element via data attributes + CSS, so both the
 * board device and the mirror agree on the look. It is visual-only: exports
 * (PNG/PDF) render the shapes, not the page furniture.
 */

export type BoardTone = "paper" | "cream" | "mint" | "sky";
export type BoardPattern = "none" | "dots" | "lines";

export interface BoardBackground {
  tone: BoardTone;
  pattern: BoardPattern;
}

export const DEFAULT_BACKGROUND: BoardBackground = { tone: "paper", pattern: "none" };

/** The `inkboard` key inside a page's meta, e.g. { inkboard: { tone, pattern } }. */
export const META_KEY = "inkboard";

export function backgroundFromMeta(
  meta: Record<string, unknown> | undefined,
): BoardBackground {
  const ink = meta?.[META_KEY];
  if (!ink || typeof ink !== "object") return DEFAULT_BACKGROUND;
  const bg = ink as Partial<BoardBackground>;
  const tone = bg.tone && TONES[bg.tone] ? bg.tone : DEFAULT_BACKGROUND.tone;
  const pattern = bg.pattern && PATTERNS.includes(bg.pattern) ? bg.pattern : DEFAULT_BACKGROUND.pattern;
  return { tone, pattern };
}

export const TONES: Record<BoardTone, string> = {
  paper: "#ffffff",
  cream: "#fdf4dc",
  mint: "#eef7ee",
  sky: "#e9f2fb",
};

export const PATTERNS: BoardPattern[] = ["none", "dots", "lines"];

/** CSS injected once by BoardCanvas; data attributes drive the look. */
export function backgroundStyleSheet(): string {
  const mark = "rgba(20, 30, 40, 0.16)";
  const faint = "rgba(20, 30, 40, 0.10)";
  const parts: string[] = [];
  for (const [tone, color] of Object.entries(TONES)) {
    parts.push(
      `[data-ink-tone="${tone}"] .tl-background { background-color: ${color}; }`,
    );
  }
  parts.push(
    `[data-ink-pattern="dots"] .tl-background {` +
      ` background-image: radial-gradient(${mark} 1.3px, transparent 1.7px);` +
      ` background-size: 22px 22px; }`,
    `[data-ink-pattern="lines"] .tl-background {` +
      ` background-image: repeating-linear-gradient(to bottom,` +
      ` transparent 0, transparent 31px, ${faint} 31px, ${faint} 32px); }`,
  );
  return parts.join("\n");
}
