export type PortraitId = 'sqwore' | 'glwzbll' | 'prince' | 'madkid';

/**
 * Stylized SVG busts in one consistent style: dark hooded/capped silhouettes with a neon rim
 * light in the rival's accent, on a hexagonal plate. МЭДКИД is drawn as he looks on stage: platinum bob
 * with bangs, pale face, septum ring, black oversized sweater and a grey scarf.
 */
export function Portrait({ id, size = 120, className = 'portrait' }: { id: PortraitId; size?: number; className?: string }) {
  const accent = id === 'sqwore' ? '#9b5de5' : id === 'glwzbll' ? '#3a86ff' : id === 'prince' ? '#e71d36' : '#f5c542';
  const gid = `pg-${id}`;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <defs>
        <linearGradient id={`${gid}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1a1c26" />
          <stop offset="1" stopColor="#0b0c10" />
        </linearGradient>
        <linearGradient id={`${gid}-rim`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={accent} stopOpacity="0.95" />
          <stop offset="0.5" stopColor={accent} stopOpacity="0.1" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${gid}-clip`}>
          <polygon points="60,4 110,32 110,88 60,116 10,88 10,32" />
        </clipPath>
        <pattern id={`${gid}-scan`} width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="1" fill="rgba(255,255,255,0.05)" />
        </pattern>
      </defs>
      <polygon points="60,4 110,32 110,88 60,116 10,88 10,32" fill={`url(#${gid}-bg)`} stroke={accent} strokeOpacity="0.55" strokeWidth="1.5" />
      <g clipPath={`url(#${gid}-clip)`}>
        {id === 'madkid' ? (
          <MadkidBust accent={accent} gid={gid} />
        ) : (
          <Bust id={id} accent={accent} gid={gid} />
        )}
        <rect x="10" y="4" width="100" height="112" fill={`url(#${gid}-scan)`} />
      </g>
      <polygon points="60,4 110,32 110,88 60,116 10,88 10,32" fill="none" stroke={`url(#${gid}-rim)`} strokeWidth="3" />
    </svg>
  );
}

function Bust({ id, accent, gid }: { id: PortraitId; accent: string; gid: string }) {
  // shoulders + neck + head + accessory; rim light on the right
  const skin = '#2a2530';
  const hood = '#15131a';
  return (
    <g>
      <radialGradient id={`${gid}-glow`} cx="0.75" cy="0.35" r="0.6">
        <stop offset="0" stopColor={accent} stopOpacity="0.55" />
        <stop offset="1" stopColor={accent} stopOpacity="0" />
      </radialGradient>
      <rect x="10" y="4" width="100" height="112" fill={`url(#${gid}-glow)`} />
      {/* shoulders */}
      <path d="M8 118 C 14 84, 40 80, 60 82 C 80 80, 106 84, 112 118 Z" fill={hood} />
      <path d="M60 82 C 80 80, 106 84, 112 118 L 96 118 C 94 96, 80 88, 60 90 Z" fill={accent} opacity="0.22" />
      {/* neck */}
      <rect x="51" y="62" width="18" height="24" fill={skin} />
      {/* head */}
      <ellipse cx="60" cy="50" rx="19" ry="23" fill={skin} />
      <path d="M79 50 C 79 36, 72 27, 60 27 L 60 73 C 72 73, 79 64, 79 50 Z" fill={accent} opacity="0.28" />
      {id === 'sqwore' && (
        <>
          {/* hood + glitch visor */}
          <path d="M36 52 C 34 24, 86 24, 84 52 L 84 40 C 84 30, 36 30, 36 40 Z" fill={hood} />
          <path d="M38 44 C 40 22, 80 22, 82 44 L 74 40 C 70 32, 50 32, 46 40 Z" fill={hood} />
          <rect x="42" y="44" width="36" height="9" fill="#0a0a0d" />
          <rect x="44" y="46" width="13" height="5" fill={accent} opacity="0.9" />
          <rect x="60" y="46" width="15" height="5" fill={accent} opacity="0.6" />
          <rect x="66" y="40" width="10" height="2" fill={accent} opacity="0.8" />
        </>
      )}
      {id === 'glwzbll' && (
        <>
          {/* cap + headset */}
          <path d="M39 42 C 40 26, 80 26, 81 42 L 88 46 L 32 46 Z" fill={hood} />
          <path d="M39 42 C 40 26, 80 26, 81 42 Z" fill="#20222c" />
          <rect x="44" y="34" width="32" height="2" fill={accent} opacity="0.8" />
          <rect x="45" y="52" width="9" height="4" fill="#0a0a0d" />
          <rect x="66" y="52" width="9" height="4" fill="#0a0a0d" />
          <rect x="46" y="53" width="7" height="2" fill={accent} />
          <rect x="67" y="53" width="7" height="2" fill={accent} />
          <path d="M36 50 C 34 40, 36 34, 40 34 L 40 60 C 36 60, 34 56, 36 50 Z" fill="#20222c" />
          <rect x="34" y="46" width="4" height="8" fill={accent} opacity="0.9" />
        </>
      )}
      {id === 'prince' && (
        <>
          {/* crown + slick hair + red shades */}
          <path d="M40 40 C 42 26, 78 26, 80 40 L 76 36 L 70 42 L 60 32 L 50 42 L 44 36 Z" fill="#141216" />
          <path d="M44 34 L 48 24 L 54 32 L 60 20 L 66 32 L 72 24 L 76 34 Z" fill={accent} />
          <path d="M44 34 L 48 24 L 54 32 L 60 20 L 66 32 L 72 24 L 76 34 Z" fill="none" stroke="#ffd1d6" strokeOpacity="0.5" strokeWidth="0.8" />
          <rect x="42" y="48" width="15" height="7" fill="#0a0a0d" />
          <rect x="63" y="48" width="15" height="7" fill="#0a0a0d" />
          <rect x="57" y="50" width="6" height="2" fill="#0a0a0d" />
          <rect x="43" y="50" width="13" height="3" fill={accent} opacity="0.7" />
          <rect x="64" y="50" width="13" height="3" fill={accent} opacity="0.7" />
        </>
      )}
      {/* chin shadow */}
      <path d="M46 62 C 50 72, 70 72, 74 62" fill="none" stroke="#0b0c10" strokeOpacity="0.5" strokeWidth="2" />
    </g>
  );
}

function MadkidBust({ accent, gid }: { accent: string; gid: string }) {
  const hair = '#e8dec3';
  const hairShade = '#cbbd98';
  const skin = '#ecd8cb';
  return (
    <g>
      <radialGradient id={`${gid}-glow`} cx="0.72" cy="0.3" r="0.65">
        <stop offset="0" stopColor={accent} stopOpacity="0.4" />
        <stop offset="1" stopColor={accent} stopOpacity="0" />
      </radialGradient>
      <rect x="10" y="4" width="100" height="112" fill={`url(#${gid}-glow)`} />
      {/* black oversized sweater */}
      <path d="M2 120 C 6 94, 28 84, 60 85 C 92 84, 114 94, 118 120 Z" fill="#141418" />
      <path d="M60 85 C 92 84, 114 94, 118 120 L 104 120 C 100 100, 84 91, 60 92 Z" fill={accent} opacity="0.16" />
      {/* neck */}
      <path d="M52 68 L 68 68 L 69 86 L 51 86 Z" fill="#d6c0b3" />
      {/* hair mass behind the face */}
      <path d="M33 52 C 31 28, 45 17, 60 17 C 76 17, 89 28, 87 52 L 90 78 C 80 83, 40 83, 30 78 Z" fill={hairShade} />
      {/* face */}
      <path d="M44 42 C 44 34, 76 34, 76 42 L 76 58 C 75 69, 66 77, 60 78 C 54 77, 45 69, 44 58 Z" fill={skin} />
      {/* sleepy eyes */}
      <path d="M47.5 55 Q 53 51 58 55 Q 53 57.5 47.5 55 Z" fill="#f3eeea" />
      <path d="M62 55 Q 67 51 72.5 55 Q 67 57.5 62 55 Z" fill="#f3eeea" />
      <circle cx="53" cy="55.6" r="1.7" fill="#4d5c68" />
      <circle cx="67" cy="55.6" r="1.7" fill="#4d5c68" />
      <path d="M47 55.3 Q 53 50.5 58.5 55.3" fill="none" stroke="#2a2126" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M61.5 55.3 Q 67 50.5 73 55.3" fill="none" stroke="#2a2126" strokeWidth="1.6" strokeLinecap="round" />
      {/* nose and septum ring */}
      <path d="M61 57 Q 62.5 62 61.2 64.6" fill="none" stroke="#a9807a" strokeWidth="0.9" />
      <path d="M58.4 65.6 A 1.7 1.7 0 0 0 61.6 65.6" fill="none" stroke="#e4e8ef" strokeWidth="1" />
      {/* lips */}
      <path d="M55 70 Q 57.5 68.6 60 69.4 Q 62.5 68.6 65 70 Q 60 71 55 70 Z" fill="#c29290" />
      <path d="M55.6 70.3 Q 60 73.6 64.4 70.3 Q 60 71.2 55.6 70.3 Z" fill="#d3a3a1" />
      {/* bangs with a jagged edge and the side curtains of the bob */}
      <path d="M39 50 C 38 30, 49 21, 60 21 C 72 21, 82 30, 81 50 L 78 53 L 75.5 47 L 72 52.5 L 68.5 46.5 L 65 51.5 L 61 46 L 57.5 51.5 L 54 46.5 L 50 52 L 46.5 47 L 43 53 Z" fill={hair} />
      <path d="M39 46 C 37 56, 38 68, 36 80 L 30 78 C 31 64, 32 52, 36 42 Z" fill={hair} />
      <path d="M39 46 L 44 50 C 44 60, 43 70, 42 80 L 36 80 C 38 68, 37 56, 39 46 Z" fill={hair} />
      <path d="M81 46 C 83 56, 82 68, 84 80 L 90 78 C 89 64, 88 52, 84 42 Z" fill={hair} />
      <path d="M81 46 L 76 50 C 76 60, 77 70, 78 80 L 84 80 C 82 68, 83 56, 81 46 Z" fill={hair} />
      <path d="M48 26 C 45 34, 44 42, 45 48 M 60 22 L 59 46 M 71 26 C 74 34, 76 42, 75 48 M 41 56 L 39 76 M 79 56 L 81 76" fill="none" stroke={hairShade} strokeWidth="0.8" />
      {/* grey scarf: wrap and the long end on his left */}
      <path d="M41 84 C 47 77, 73 77, 79 84 C 76 92, 44 92, 41 84 Z" fill="#7b8491" />
      <path d="M70 87 C 75 96, 77 108, 75 120 L 88 120 C 90 106, 86 94, 80 84 Z" fill="#6c7581" />
      <g fill="#aeb6c1" opacity="0.75">
        <circle cx="50" cy="84" r="1" />
        <circle cx="60" cy="86" r="1" />
        <circle cx="70" cy="84" r="1" />
        <circle cx="79" cy="96" r="1" />
        <circle cx="82" cy="106" r="1" />
        <circle cx="80" cy="116" r="1" />
      </g>
      {/* rim light */}
      <path d="M84 42 C 88 52, 89 64, 90 78" fill="none" stroke={accent} strokeOpacity="0.55" strokeWidth="1.4" />
    </g>
  );
}
