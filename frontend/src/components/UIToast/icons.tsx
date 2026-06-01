/**
 * Иконки тостов — простые SVG, чтобы избежать кросс-платформенных
 * различий emoji-рендера (Linux/Win/Mac).
 */
import { FC, SVGProps } from "react";

const baseProps: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export const ErrorIcon: FC = () => (
  <svg {...baseProps}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12.5" />
    <circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const WarningIcon: FC = () => (
  <svg {...baseProps}>
    <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const InfoIcon: FC = () => (
  <svg {...baseProps}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="11" x2="12" y2="16" />
    <circle cx="12" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const SuccessIcon: FC = () => (
  <svg {...baseProps}>
    <circle cx="12" cy="12" r="10" />
    <path d="m8 12.5 2.8 2.8L16.5 9.5" />
  </svg>
);
