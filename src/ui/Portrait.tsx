import madkidFace from '@/assets/madk1d_face_big.jpg';

export type PortraitId = 'sqwore' | 'glwzbll' | 'prince' | 'madkid';

/**
 * Stylized SVG busts in one consistent style: dark hooded/capped silhouettes with a neon rim
 * light in the rival's accent, on a hexagonal plate. МЭДКИД uses the real bull-terrier logo.
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
          <>
            <image href={madkidFace} x="10" y="14" width="100" height="100" preserveAspectRatio="xMidYMid slice" />
            <rect x="10" y="4" width="100" height="112" fill={`url(#${gid}-rim)`} opacity="0.35" />
          </>
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
