import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p });

export const IFlag = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 21V4" />
    <path d="M5 4h11l-2 4 2 4H5" />
  </svg>
);
export const ICar = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5" />
    <path d="M3 13h18v4a1 1 0 0 1-1 1h-1a2 2 0 1 1-4 0H9a2 2 0 1 1-4 0H4a1 1 0 0 1-1-1z" />
  </svg>
);
export const IWrench = (p: P) => (
  <svg {...base(p)}>
    <path d="M14.5 6.5a4 4 0 0 0 4.9 4.9L21 13l-3 3-1.6-1.6a4 4 0 0 0-4.9-4.9L9 7l-6 6 4 4 6-6" />
  </svg>
);
export const ITrophy = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
    <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" />
    <path d="M12 14v4M8 21h8M9 18h6" />
  </svg>
);
export const IMusic = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 18V6l10-2v12" />
    <circle cx="7" cy="18" r="2" />
    <circle cx="17" cy="16" r="2" />
  </svg>
);
export const ISettings = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const IPlay = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none" />
  </svg>
);
export const IPause = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor" stroke="none" />
  </svg>
);
export const IStop = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6h12v12H6z" fill="currentColor" stroke="none" />
  </svg>
);
export const IPrev = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 5v14M19 5l-11 7 11 7z" fill="currentColor" />
  </svg>
);
export const INext = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 5v14M5 5l11 7-11 7z" fill="currentColor" />
  </svg>
);
export const IBack = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
export const ILock = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="10" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
export const IStar = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.3L12 17.5l-5.6 2.9 1.1-6.3L3 9.7l6.2-.9z" fill="currentColor" stroke="none" />
  </svg>
);
export const ISkull = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3a8 8 0 0 0-8 8c0 2.6 1.3 4.6 3 5.8V20h10v-3.2c1.7-1.2 3-3.2 3-5.8a8 8 0 0 0-8-8z" />
    <circle cx="9" cy="11" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="15" cy="11" r="1.6" fill="currentColor" stroke="none" />
    <path d="M10 20v-2M14 20v-2" />
  </svg>
);
export const INitro = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 2L4 14h6l-1 8 9-12h-6z" fill="currentColor" stroke="none" />
  </svg>
);
export const ICamera = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8h3l2-2h6l2 2h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const IVolume = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 10v4h3l4 3V7l-4 3z" fill="currentColor" stroke="none" />
    <path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a8 8 0 0 1 0 11" />
  </svg>
);
export const ICheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12l5 5 9-10" />
  </svg>
);
export const IClose = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const ICoin = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7v10M9.5 9.5h3.5a1.5 1.5 0 0 1 0 3h-2a1.5 1.5 0 0 0 0 3h3.5" />
  </svg>
);
export const IMedal = ({ place, ...p }: P & { place: number }) => {
  const c = place === 1 ? '#f5c542' : place === 2 ? '#c9ccd6' : '#c47a3a';
  return (
    <svg {...base(p)} stroke={c}>
      <circle cx="12" cy="14" r="5" fill={c} stroke="none" />
      <path d="M9 3l3 6 3-6" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="7" fill="#0b0c10" stroke="none" fontFamily="Russo One, sans-serif">
        {place}
      </text>
    </svg>
  );
};
export const IArrowUp = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 20V5M5 12l7-7 7 7" />
  </svg>
);
export const IArrowDown = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4v15M5 12l7 7 7-7" />
  </svg>
);
export const IArrowLeft = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 12H5M12 5l-7 7 7 7" />
  </svg>
);
export const IArrowRight = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12h15M12 5l7 7-7 7" />
  </svg>
);
export const IFire = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3c1 3 4 4 4 8a4 4 0 0 1-8 0c0-1.5.5-2.5 1-3 .3 1 1 1.5 1.5 1.5C11 7 10 5 12 3z" fill="currentColor" stroke="none" />
  </svg>
);
export const IRun = (p: P) => (
  <svg {...base(p)}>
    <circle cx="14" cy="4.5" r="1.8" fill="currentColor" stroke="none" />
    <path d="M9 21l3-6-3-3 4-4 3 3h4M9 12l-4 2" />
  </svg>
);
export const IRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />
  </svg>
);
export const IMap = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
    <path d="M9 4v14M15 6v14" />
  </svg>
);
