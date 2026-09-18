import { motion } from 'framer-motion';

interface AnimatedLogoProps {
  size?: number;
  className?: string;
}

const PETALS = [0, 45, 90, 135, 180, 225, 270, 315];
const STAMENS = [18, 63, 108, 153, 198, 243, 288, 333];

export function AnimatedLogo({ size = 40, className }: AnimatedLogoProps) {
  return (
    <motion.div
      className={`relative flex items-center justify-center ${className ?? ''}`}
      style={{ width: size, height: size }}
      animate={{
        filter: [
          'drop-shadow(0 0 2px rgba(230,57,70,0.25))',
          'drop-shadow(0 0 9px rgba(230,57,70,0.6))',
          'drop-shadow(0 0 2px rgba(230,57,70,0.25))',
        ],
      }}
      transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
    >
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <defs>
          <linearGradient id="ltcPetal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fa6b78" />
            <stop offset="55%" stopColor="#e63946" />
            <stop offset="100%" stopColor="#9e101c" />
          </linearGradient>
          <radialGradient id="ltcCore" cx="0.35" cy="0.35" r="0.9">
            <stop offset="0%" stopColor="#ffd0c2" />
            <stop offset="40%" stopColor="#ff6b4a" />
            <stop offset="75%" stopColor="#c1121f" />
            <stop offset="100%" stopColor="#7c0c16" />
          </radialGradient>
        </defs>

        {/* Rotating dashed aura */}
        <motion.g
          style={{ originX: '50%', originY: '50%' }}
          animate={{ rotate: 360 }}
          transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
        >
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="#e63946"
            strokeWidth="1.6"
            strokeOpacity="0.55"
            strokeDasharray="3 7"
            strokeLinecap="round"
          />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="#ff8a80"
            strokeWidth="5"
            strokeOpacity="0.15"
            strokeDasharray="1 34"
            strokeLinecap="round"
          />
        </motion.g>

        {/* Stamens (filamentos) */}
        <motion.g
          animate={{ opacity: [0.35, 0.9, 0.35] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          {STAMENS.map((deg, i) => (
            <motion.line
              key={deg}
              x1="50"
              y1="50"
              x2="50"
              y2="2"
              stroke="#ffb3b3"
              strokeWidth="0.7"
              strokeOpacity="0.65"
              transform={`rotate(${deg} 50 50)`}
              animate={{ attrY: [2, -3, 2], opacity: [0.4, 0.9, 0.4] }}
              transition={{ duration: 1.8 + (i % 3) * 0.4, repeat: Infinity, delay: i * 0.12 }}
            />
          ))}
        </motion.g>

        {/* Pétalos */}
        <motion.g
          style={{ originX: '50%', originY: '50%' }}
          animate={{ scale: [1, 1.045, 1], rotate: [-3, 3, -3] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          {PETALS.map((deg, i) => (
            <motion.g
              key={deg}
              transform={`rotate(${deg} 50 50)`}
              animate={{ opacity: [0.82, 1, 0.82] }}
              transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.18 }}
            >
              <path
                d="M50,54 C55,40 59,26 54,10 C47,24 45,38 50,54 Z"
                fill="url(#ltcPetal)"
                stroke="#8a0f1c"
                strokeWidth="0.8"
                strokeOpacity="0.55"
                strokeLinejoin="round"
              />
              <path
                d="M50,54 C53,42 55,31 52.5,18 C49.5,30 48,40 50,54 Z"
                fill="#ffffff"
                opacity="0.12"
              />
            </motion.g>
          ))}
        </motion.g>

        {/* Corazón/lirio central */}
        <motion.g
          style={{ originX: '50%', originY: '50%' }}
          animate={{ scale: [1, 1.12, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <circle cx="50" cy="50" r="9" fill="url(#ltcCore)" />
          <circle cx="50" cy="50" r="9" fill="none" stroke="#ff8a80" strokeWidth="1.2" strokeOpacity="0.7" />
          <circle cx="46.5" cy="46.5" r="3" fill="#ffd9d0" opacity="0.85" />
        </motion.g>
      </svg>
    </motion.div>
  );
}