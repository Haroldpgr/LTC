import { useMemo } from 'react';
import { motion } from 'framer-motion';

const PETALS = [0, 40, 80, 120, 160, 200, 240, 280, 320];

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
      Array.from({ length: 80 }, (_, i) => ({
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
          className="absolute left-1/2 top-1/2 w-[560px] h-[560px] rounded-full"
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

      {/* Logo creándose */}
      <motion.svg
        viewBox="0 0 100 100"
        className="w-52 h-52 relative"
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
        </defs>

        {/* Aros dibujándose */}
        <motion.circle
          cx="50" cy="44" r="42" fill="none" stroke="#e63946" strokeWidth="1.8"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.95 }}
          transition={{ duration: 1.6, ease: 'easeInOut', delay: 0.1 }}
        />
        <motion.circle
          cx="53" cy="44" r="38.5" fill="none" stroke="#ff8ba0" strokeWidth="1.1"
          strokeDasharray="2 9" strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.6 }}
          transition={{ duration: 1.8, ease: 'easeInOut', delay: 0.3 }}
        />

        {/* Pétalos naciendo desde el centro */}
        {PETALS.map((deg, i) => (
          <motion.g key={deg} transform={`rotate(${deg} 50 44)`}>
            <motion.path
              d="M50,48 C53.5,36 55,22 50,8 C45,22 46.5,36 50,48 Z"
              fill="url(#splashPetal)"
              stroke="#7c0c16"
              strokeWidth="0.7"
              style={{ originX: '50px', originY: '48px' }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.5 + i * 0.12, type: 'spring', stiffness: 260, damping: 16 }}
            />
          </motion.g>
        ))}

        {/* Núcleo con explosión de luz */}
        <motion.circle
          cx="50" cy="44" r="16" fill="#ff5a3c"
          initial={{ opacity: 0, scale: 0.3 }}
          animate={{ opacity: [0, 0.5, 0], scale: [0.3, 1.4, 1.4] }}
          transition={{ duration: 1.1, delay: 1.4 }}
          style={{ originX: '50px', originY: '44px' }}
        />
        <motion.g
          style={{ originX: '50px', originY: '44px' }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 1.5, type: 'spring', stiffness: 300, damping: 14 }}
        >
          <circle cx="50" cy="44" r="7" fill="url(#splashCore)" />
          <circle cx="50" cy="44" r="7" fill="none" stroke="#ffd9e0" strokeWidth="1" />
          <circle cx="47.5" cy="41.5" r="2.2" fill="#fff7e8" />
        </motion.g>

        {/* Destellos apareciendo */}
        {[
          [50, 4.5], [12, 46], [88, 46], [26, 20], [74, 20],
        ].map(([x, y], i) => (
          <motion.path
            key={i}
            d="M0,-1 C0.12,-0.32 0.32,-0.12 1,0 C0.32,0.12 0.12,0.32 0,1 C-0.12,0.32 -0.32,0.12 -1,0 C-0.32,-0.12 -0.12,-0.32 0,-1 Z"
            fill="#ffd9e0"
            transform={`translate(${x} ${y}) scale(3)`}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: [0, 1, 0.4, 1], scale: 1 }}
            transition={{ delay: 1.7 + i * 0.15, duration: 1.2 }}
            style={{ originX: `${x}px`, originY: `${y}px` }}
          />
        ))}
      </motion.svg>

      {/* Título */}
      <motion.h1
        className="relative mt-2 text-2xl font-extrabold tracking-[0.35em] text-white"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.9, duration: 0.6 }}
      >
        LTC LAUNCHER
      </motion.h1>
      <motion.p
        className="relative mt-1 text-[11px] tracking-[0.2em] text-primary-300/80 uppercase"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.2, duration: 0.6 }}
      >
        Tu portal al mundo de Minecraft
      </motion.p>

      {/* Barra de carga */}
      <div className="relative mt-6 w-52 h-1 rounded-full bg-dark-800 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent-500"
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 3, ease: 'easeInOut', delay: 0.3 }}
        />
      </div>
    </motion.div>
  );
}
