import type { SVGProps } from 'react';

/**
 * Local inline SVG icon set (owner decision: no icon package, no external CDN).
 * Icons are decorative by default (`aria-hidden`); the surrounding control owns
 * the accessible name.
 */
type IconProps = SVGProps<SVGSVGElement>;

const baseProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

export function IconSearch(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconExternalApp(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

export function IconThumbsUp(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M7 10.5V20H4.5A1.5 1.5 0 0 1 3 18.5v-6.5A1.5 1.5 0 0 1 4.5 10.5H7Z" />
      <path d="M7 10.5 11 3.8a1.4 1.4 0 0 1 2.5.9v3.6h4.6a2 2 0 0 1 2 2.4l-1.1 6.6a2 2 0 0 1-2 1.7H7" />
    </svg>
  );
}

export function IconComment(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M20 12a7.5 7.5 0 0 1-7.5 7.5H8l-4 2.5 1-4.3A7.5 7.5 0 1 1 20 12Z" />
    </svg>
  );
}

export function IconShare(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" />
    </svg>
  );
}

export function IconTip(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M9.5 10.5h4.4a1.6 1.6 0 0 1 0 3.2H10" />
    </svg>
  );
}

export function IconVideo(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="3" y="6" width="12.5" height="12" rx="2" />
      <path d="m15.5 12 5.5-3.2v6.4L15.5 12Z" />
    </svg>
  );
}

export function IconImage(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4.5 17.5 5-5 3.5 3.5 3-2.5 3.5 3" />
    </svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function IconWarning(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 4.5 21 19.5H3L12 4.5Z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </svg>
  );
}
