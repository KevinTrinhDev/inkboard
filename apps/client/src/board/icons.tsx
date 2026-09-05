import type { SVGProps } from "react";

/**
 * Minimal line-icon set for the toolbar: hand-authored inline SVG rather
 * than an icon package dependency, since the toolbar only needs a dozen
 * glyphs and this keeps the bundle free of an extra font/sprite fetch. 24x24
 * viewBox, 1.75px stroke, no fill, matches across every icon here.
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

export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M2 12s3.5-7 10-7c1.9 0 3.5.5 4.9 1.2M22 12s-3.5 7-10 7c-1.9 0-3.5-.5-4.9-1.2" />
      <path d="M15.5 9.5a3 3 0 0 1-4.2 4.2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function ChevronLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  );
}

export function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </svg>
  );
}

export function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4v10" />
      <path d="m8 10 4 4 4-4" />
      <path d="M4 19h16" />
    </svg>
  );
}

export function PaintIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M5 3h9l5 5v13H5z" />
      <path d="M14 3v5h5" />
      <path d="M8 14c0 1.4-.6 2.2-1.6 2.6" strokeWidth={1.4} />
    </svg>
  );
}

export function SwatchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" fill="currentColor" stroke="none" opacity={0.5} />
      <rect x="3" y="14" width="7" height="7" rx="2" fill="currentColor" stroke="none" opacity={0.5} />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  );
}
