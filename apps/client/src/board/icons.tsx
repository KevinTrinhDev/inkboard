import type { SVGProps } from "react";

/**
 * Minimal line-icon set for the toolbar — hand-authored inline SVG rather
 * than an icon package dependency, since the toolbar only needs ~10 glyphs
 * and this keeps the bundle free of an extra font/sprite fetch. 24x24
 * viewBox, 1.75px stroke, no fill — matches across every icon here.
 */

const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function SelectIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M5 3l6.5 16 2-6.5L20 10.5 5 3z" />
    </svg>
  );
}

export function PenIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L8.5 18.5 4 20l1.5-4.5L17.5 3.5z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}

export function EraserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M18 13.5L10.5 21H6l-3-3 9-9 8 8-2 -3.5z" />
      <path d="M13.5 3.5l7 7L14 17H9.5l-6-6 6.5-6.5a2 2 0 0 1 3.5-1z" />
      <path d="M9.5 17H20" />
    </svg>
  );
}

export function TextIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M5 5h14" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </svg>
  );
}

export function MathIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M18 4H8l4.5 8L8 20h10" />
    </svg>
  );
}

export function ArrowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M5 19L19 5" />
      <path d="M9 5h10v10" />
    </svg>
  );
}

export function ShapeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="9" width="10" height="10" rx="1.5" />
      <circle cx="16.5" cy="7.5" r="4.5" />
    </svg>
  );
}

export function UndoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M7 8H4V5" />
      <path d="M4 8a9 9 0 1 1 -2.3 6" />
    </svg>
  );
}

export function RedoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M17 8h3V5" />
      <path d="M20 8a9 9 0 1 0 2.3 6" />
    </svg>
  );
}

export function PageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
    </svg>
  );
}

export function RecordIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function StopIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
