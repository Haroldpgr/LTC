import { motion } from 'framer-motion';

interface AnimatedLogoProps {
  size?: number;
  className?: string;
}

// 9 pétalos radiales como el lirio de la imagen
const PETALS = [0, 40, 80, 120, 160, 200, 240, 280, 320];

// Destellos de 4 puntas: [x, y, tamaño, delay]
const SPARKS: Array<[number, number, number, number]> = [
  [50, 4.5, 4.2, 0],
  [12, 46, 3.4, 0.5],
  [88, 46, 3.4, 1.1],
  [26, 22, 2.2, 1.6],
  [74, 22, 2.2, 0.8],
  [50, 88, 2.4, 1.9],
];

// Colgantes: [x ancla, largo, tamaño, delay balanceo]
const PENDANTS: Array<[number, number, number, number]> = [
  [32, 12, 3.2, 0],
  [50, 16, 4, 0.7],
  [68, 12, 3.2, 1.3],
];

function Sparkle({ x, y, s, delay }: { x: number; y: number; s: number; delay: number }) {
  return (
    <motion.path
      d="M0,-1 C0.12,-0.32 0.32,-0.12 1,0 C0.32,0.12 0.12,0.32 0,1 C-0.12,0.32 -0.32,0.12 -1,0 C-0.32,-0.12 -0.12,-0.32 0,-1 Z"
      fill="#ffd9e0"
      transform={`translate(${x} ${y}) scale(${s})`}
      style={{ originX: `${x}px`, originY: `${y}px` }}
      animate={{ opacity: [0.25, 1, 0.25], scale: [s * 0.7, s * 1.15, s * 0.7] }}
      transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut', delay }}
    />
  );
}

export function AnimatedLogo({ size = 40, className }: AnimatedLogoProps) {
  return (
    <motion.div
      className={`relative flex items-center justify-center ${className ?? ''}`}
      style={{ width: size, height: size }}
      animate={{
        filter: [
          'drop-shadow(0 0 2px rgba(255,70,100,0.35))',
          'drop-shadow(0 0 10px rgba(255,60,90,0.65))',
          'drop-shadow(0 0 2px rgba(255,70,100,0.35))',
        ],
      }}
      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
    >
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <defs>
          <linearGradient id="ltcPetal" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#8a0f1c" />
            <stop offset="45%" stopColor="#e63946" />
            <stop offset="80%" stopColor="#ff7a8a" />
            <stop offset="100%" stopColor="#ffc2cb" />
          </linearGradient>
          <radialGradient id="ltcCore" cx="0.4" cy="0.35" r="0.9">
            <stop offset="0%" stopColor="#fff3d6" />
            <stop offset="30%" stopColor="#ffb35c" />
            <stop offset="60%" stopColor="#ff5a3c" />
            <stop offset="100%" stopColor="#a30f22" />
          </radialGradient>
          <linearGradient id="ltcHoop" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ff8ba0" />
            <stop offset="50%" stopColor="#e63946" />
            <stop offset="100%" stopColor="#ff8ba0" />
          </linearGradient>
          <linearGradient id="ltcCrystal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffd9e0" />
            <stop offset="100%" stopColor="#c81e3a" />
          </linearGradient>
        </defs>

        {/* Aro doble del atrapasueños (rotación lenta opuesta) */}
        <motion.g
          style={{ originX: '50px', originY: '44px' }}
          animate={{ rotate: 360 }}
          transition={{ duration: 26, repeat: Infinity, ease: 'linear' }}
        >
          <circle cx="50" cy="44" r="42" fill="none" stroke="url(#ltcHoop)" strokeWidth="1.8" strokeOpacity="0.9" />
          <circle cx="50" cy="44" r="42" fill="none" stroke="#ff6b85" strokeWidth="4.5" strokeOpacity="0.12" />
        </motion.g>
        <motion.g
          style={{ originX: '50px', originY: '44px' }}
          animate={{ rotate: -360 }}
          transition={{ duration: 34, repeat: Infinity, ease: 'linear' }}
        >
          <circle
            cx="53" cy="44" r="38.5" fill="none" stroke="#ff8ba0"
            strokeWidth="1.1" strokeOpacity="0.55" strokeDasharray="2 9" strokeLinecap="round"
          />
          <circle cx="53" cy="5.5" r="1.8" fill="#ffd9e0" />
          <circle cx="14.5" cy="44" r="1.4" fill="#ff8ba0" opacity="0.8" />
        </motion.g>

        {/* Colgantes inferiores con balanceo */}
        {PENDANTS.map(([x, len, s, delay], i) => (
          <motion.g
            key={i}
            style={{ originX: `${x}px`, originY: '82px' }}
            animate={{ rotate: [-4, 4, -4] }}
            transition={{ duration: 3 + i * 0.5, repeat: Infinity, ease: 'easeInOut', delay }}
          >
            <line x1={x} y1={80 - len * 0.4} x2={x} y2={82 + len} stroke="#ff8ba0" strokeWidth="0.8" strokeOpacity="0.7" />
            <path
              d={`M${x},${82 + len} c${s * 0.55},${s * 0.6} ${s * 0.55},${s * 1.5} 0,${s * 2.1} c-${s * 0.55},-${s * 0.6} -${s * 0.55},-${s * 1.5} 0,-${s * 2.1} Z`}
              fill="url(#ltcCrystal)"
              stroke="#ffd9e0"
              strokeWidth="0.4"
              strokeOpacity="0.8"
            />
            <circle cx={x} cy={82 + len + s * 0.7} r={s * 0.28} fill="#fff" opacity="0.9" />
          </motion.g>
        ))}

        {/* Pétalos del lirio */}
        <motion.g
          style={{ originX: '50px', originY: '44px' }}
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        >
          {PETALS.map((deg, i) => (
            <motion.g
              key={deg}
              transform={`rotate(${deg} 50 44)`}
              animate={{ opacity: [0.85, 1, 0.85] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut', delay: i * 0.22 }}
            >
              <path
                d="M50,48 C53.5,36 55,22 50,8 C45,22 46.5,36 50,48 Z"
                fill="url(#ltcPetal)"
                stroke="#7c0c16"
                strokeWidth="0.7"
                strokeOpacity="0.6"
                strokeLinejoin="round"
              />
              <path
                d="M50,48 C51.8,38 52.6,27 50.5,15 C48.8,27 48.6,38 50,48 Z"
                fill="#ffffff"
                opacity="0.14"
              />
            </motion.g>
          ))}
        </motion.g>

        {/* Núcleo brillante pulsante */}
        <motion.g
          style={{ originX: '50px', originY: '44px' }}
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          <circle cx="50" cy="44" r="10.5" fill="#ff5a3c" opacity="0.25" />
          <circle cx="50" cy="44" r="7" fill="url(#ltcCore)" />
          <circle cx="50" cy="44" r="7" fill="none" stroke="#ffd9e0" strokeWidth="1" strokeOpacity="0.8" />
          <circle cx="47.5" cy="41.5" r="2.2" fill="#fff7e8" opacity="0.95" />
        </motion.g>

        {/* Destellos titilantes */}
        {SPARKS.map(([x, y, s, delay], i) => (
          <Sparkle key={i} x={x} y={y} s={s} delay={delay} />
        ))}
      </svg>
    </motion.div>
  );
}
