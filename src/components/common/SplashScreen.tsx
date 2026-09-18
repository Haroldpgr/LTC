import { useMemo } from 'react';
import { motion } from 'framer-motion';

// Idéntico al generador AnimatedLogo: 9 pétalos, destellos y colgantes.
const PETALS = [0, 40, 80, 120, 160, 200, 240, 280, 320];

const SPARKS: Array<[number, number, number, number]> = [
  [50, 4.5, 4.2, 2.6],
  [12, 46, 3.4, 3.0],
  [88, 46, 3.4, 3.4],
  [26, 22, 2.2, 3.8],
  [74, 22, 2.2, 3.2],
  [50, 88, 2.4, 4.1],
];

const PENDANTS: Array<[number, number, number, number]> = [
  [32, 12, 3.2, 0],
  [50, 16, 4, 0.7],
  [68, 12, 3.2, 1.3],
];

interface Star {
  id: number;
  x: number;
  size: number;
  duration: number;
  delay: number;
  color: string;
  opacity: number;
}

export function SplashScreen() {
  const stars = useMemo<Star[]>(
    () =>
      Array.from({ length: 90 }, (_, i) => ({
        id: i,
        x: (i * 37.7 + 13) % 100,
        size: 1 + ((i * 7) % 3) * 0.8,
        duration: 2.2 + ((i * 13) % 40) / 10,
        delay: ((i * 29) % 40) / 10,
        color: i % 5 === 0 ? '#ff8ba0' : i % 7 === 0 ? '#ff5a3c' : '#ffffff',
        opacity: 0.3 + ((i * 11) % 50) / 100,
      })),
    []
  );

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-dark-950 overflow-hidden"
      exit={{ opacity: 0, scale: 1.06, filter: 'blur(6px)' }}
      transition={{ duration: 0.6, ease: 'easeInOut' }}
    >
      {/* Fondo: resplandor + estrellas pasando */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div
          className="absolute left-1/2 top-1/2 w-[620px] h-[620px] rounded-full"
          style={{ x: '-50%', y: '-50%', background: 'radial-gradient(circle, rgba(230,57,70,0.16) 0%, transparent 65%)' }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        {stars.map((s) => (
          <motion.span
            key={s.id}
            className="absolute rounded-full"
            style={{
              left: `${s.x}%`,
              top: '-4%',
              width: s.size,
              height: s.size,
              backgroundColor: s.color,
              boxShadow: `0 0 ${s.size * 2}px ${s.color}`,
            }}
            initial={{ y: '0vh', opacity: 0 }}
            animate={{ y: '108vh', opacity: [0, s.opacity, s.opacity, 0] }}
            transition={{ duration: s.duration, delay: s.delay, repeat: Infinity, ease: 'linear' }}
          />
        ))}
      </div>

      {/* Logo creándose, igual que el generador */}
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 2.2 }}
        className="relative"
      >
        <motion.svg
          viewBox="0 0 100 100"
          className="w-60 h-60 relative"
          style={{ filter: 'drop-shadow(0 0 18px rgba(255,60,90,0.55))' }}
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          <defs>
            <linearGradient id="splashPetal" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#8a0f1c" />
              <stop offset="45%" stopColor="#e63946" />
              <stop offset="80%" stopColor="#ff7a8a" />
              <stop offset="100%" stopColor="#ffc2cb" />
            </linearGradient>
            <radialGradient id="splashCore" cx="0.4" cy="0.35" r="0.9">
              <stop offset="0%" stopColor="#fff3d6" />
              <stop offset="30%" stopColor="#ffb35c" />
              <stop offset="60%" stopColor="#ff5a3c" />
              <stop offset="100%" stopColor="#a30f22" />
            </radialGradient>
            <linearGradient id="splashHoop" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ff8ba0" />
              <stop offset="50%" stopColor="#e63946" />
              <stop offset="100%" stopColor="#ff8ba0" />
            </linearGradient>
            <linearGradient id="splashCrystal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffd9e0" />
              <stop offset="100%" stopColor="#c81e3a" />
            </linearGradient>
          </defs>

          {/* Aro doble dibujándose + rotación continua */}
          <motion.g
            style={{ originX: '50px', originY: '44px' }}
            animate={{ rotate: 360 }}
            transition={{ duration: 26, repeat: Infinity, ease: 'linear', delay: 1.6 }}
          >
            <motion.circle
              cx="50" cy="44" r="42" fill="none" stroke="url(#splashHoop)" strokeWidth="1.8"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.95 }}
              transition={{ duration: 1.6, ease: 'easeInOut', delay: 0.1 }}
            />
            <circle cx="50" cy="44" r="42" fill="none" stroke="#ff6b85" strokeWidth="4.5" strokeOpacity="0.12" />
          </motion.g>
          <motion.g
            style={{ originX: '50px', originY: '44px' }}
            animate={{ rotate: -360 }}
            transition={{ duration: 34, repeat: Infinity, ease: 'linear', delay: 1.9 }}
          >
            <motion.circle
              cx="53" cy="44" r="38.5" fill="none" stroke="#ff8ba0"
              strokeWidth="1.1" strokeDasharray="2 9" strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.6 }}
              transition={{ duration: 1.8, ease: 'easeInOut', delay: 0.3 }}
            />
            <circle cx="53" cy="5.5" r="1.8" fill="#ffd9e0" />
            <circle cx="14.5" cy="44" r="1.4" fill="#ff8ba0" opacity="0.8" />
          </motion.g>

          {/* Colgantes apareciendo + balanceo */}
          {PENDANTS.map(([x, len, s, delay], i) => (
            <motion.g
              key={i}
              style={{ originX: `${x}px`, originY: '82px' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, rotate: [-4, 4, -4] }}
              transition={{
                opacity: { delay: 1.1 + i * 0.2, duration: 0.5 },
                rotate: { duration: 3 + i * 0.5, repeat: Infinity, ease: 'easeInOut', delay: 1.6 + delay },
              }}
            >
              <line x1={x} y1={80 - len * 0.4} x2={x} y2={82 + len} stroke="#ff8ba0" strokeWidth="0.8" strokeOpacity="0.7" />
              <path
                d={`M${x},${82 + len} c${s * 0.55},${s * 0.6} ${s * 0.55},${s * 1.5} 0,${s * 2.1} c-${s * 0.55},-${s * 0.6} -${s * 0.55},-${s * 1.5} 0,-${s * 2.1} Z`}
                fill="url(#splashCrystal)"
                stroke="#ffd9e0"
                strokeWidth="0.4"
                strokeOpacity="0.8"
              />
              <circle cx={x} cy={82 + len + s * 0.7} r={s * 0.28} fill="#fff" opacity="0.9" />
            </motion.g>
          ))}

          {/* Pétalos naciendo desde el centro */}
          <motion.g
            style={{ originX: '50px', originY: '44px' }}
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 2.4 }}
          >
            {PETALS.map((deg, i) => (
              <motion.g key={deg} transform={`rotate(${deg} 50 44)`}>
                <motion.path
                  d="M50,48 C53.5,36 55,22 50,8 C45,22 46.5,36 50,48 Z"
                  fill="url(#splashPetal)"
                  stroke="#7c0c16"
                  strokeWidth="0.7"
                  style={{ originX: '50px', originY: '48px' }}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: [0.85, 1, 0.85] }}
                  transition={{
                    scale: { delay: 0.5 + i * 0.12, type: 'spring', stiffness: 260, damping: 16 },
                    opacity: { duration: 2.8, repeat: Infinity, ease: 'easeInOut', delay: 1.6 + i * 0.22 },
                  }}
                />
              </motion.g>
            ))}
          </motion.g>

          {/* Explosión de luz + núcleo */}
          <motion.circle
            cx="50" cy="44" r="16" fill="#ff5a3c"
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{ opacity: [0, 0.5, 0], scale: [0.3, 1.4, 1.4] }}
            transition={{ duration: 1.1, delay: 1.7 }}
            style={{ originX: '50px', originY: '44px' }}
          />
          <motion.g
            style={{ originX: '50px', originY: '44px' }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [null, 1.15, 1], opacity: 1 }}
            transition={{ scale: { delay: 1.8, type: 'spring', stiffness: 300, damping: 14 }, opacity: { delay: 1.8 } }}
          >
            <circle cx="50" cy="44" r="7" fill="url(#splashCore)" />
            <circle cx="50" cy="44" r="7" fill="none" stroke="#ffd9e0" strokeWidth="1" />
            <circle cx="47.5" cy="41.5" r="2.2" fill="#fff7e8" />
          </motion.g>

          {/* Destellos */}
          {SPARKS.map(([x, y, s, delay], i) => (
            <motion.path
              key={i}
              d="M0,-1 C0.12,-0.32 0.32,-0.12 1,0 C0.32,0.12 0.12,0.32 0,1 C-0.12,0.32 -0.32,0.12 -1,0 C-0.32,-0.12 -0.12,-0.32 0,-1 Z"
              fill="#ffd9e0"
              transform={`translate(${x} ${y}) scale(${s})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0.4, 1] }}
              transition={{ delay, duration: 1.6, repeat: Infinity }}
              style={{ originX: `${x}px`, originY: `${y}px` }}
            />
          ))}
        </motion.svg>
      </motion.div>

      {/* Título */}
      <motion.h1
        className="relative mt-2 text-2xl font-extrabold tracking-[0.35em] text-white"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2.6, duration: 0.6 }}
      >
        LTC LAUNCHER
      </motion.h1>
      <motion.p
        className="relative mt-1 text-[11px] tracking-[0.2em] text-primary-300/80 uppercase"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 3, duration: 0.6 }}
      >
        Tu portal al mundo de Minecraft
      </motion.p>

      {/* Barra de carga */}
      <div className="relative mt-6 w-52 h-1 rounded-full bg-dark-800 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent-500"
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 5.2, ease: 'easeInOut', delay: 0.3 }}
        />
      </div>
    </motion.div>
  );
}
