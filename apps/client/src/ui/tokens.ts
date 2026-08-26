/**
 * Shared design tokens for the app's chrome (toolbar, checklist, camera
 * preview). Pulled out of AppToolbar.tsx and PreflightChecklist.tsx, which
 * previously repeated the same color/blur literals independently, so
 * changing the look (background color, blur amount, accent) is a one-file
 * edit instead of a hunt across components.
 *
 * This is a deliberately dark-only palette, not a light/dark theme system.
 * A recording tool used in varied lighting benefits from a single considered
 * dark surface more than from a toggle nobody asked for; if that changes,
 * these constants are the place a real theme system would plug in.
 */

export const glass = {
  // The translucent dark surface + blur combination already established in
  // AppToolbar's pill containers. Reused everywhere for visual consistency.
  surface: "rgba(20, 20, 22, 0.92)",
  border: "rgba(255, 255, 255, 0.08)",
  divider: "rgba(255, 255, 255, 0.1)",
  blur: "blur(12px)",
  shadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
} as const;

export const text = {
  active: "#ffffff",
  muted: "#c9c9c9",
  dim: "#a1a1a6",
  onDim: "#e8e8ea",
} as const;

export const accent = {
  active: "rgba(255, 255, 255, 0.14)",
  // A visible ring, not just a background tint, on the active tool button.
  // A 14% white overlay alone is too subtle to reliably read at a glance in
  // bright light (found from real hardware feedback) — the ring makes the
  // active state unambiguous regardless of ambient lighting.
  activeRing: "#5b8dff",
  record: "#ef4444",
} as const;

export const status = {
  ok: "#4ade80",
  pending: "#4a4a4d",
  warn: "#facc15",
} as const;
