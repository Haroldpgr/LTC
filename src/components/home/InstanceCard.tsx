import { motion } from 'framer-motion';
import { Play, Download, Server, Package, Loader2, CheckCircle } from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { InstanceIcon } from '@/components/common/InstanceIcon';
import type { ModpackInstance } from '@/types';

interface Props {
  instance: ModpackInstance;
}

export function InstanceCard({ instance }: Props) {
  const { selectInstance, play, installInstance, launcherState, runningInstanceId } = useInstanceStore();
  const isBusy = launcherState.isLaunching || launcherState.isInstalling;
  const isRunning = runningInstanceId === instance.id;
  const isInstalling = launcherState.isInstalling;

  const handleAction = () => {
    if (instance.isInstalled) {
      play(instance.id);
    } else {
      installInstance(instance.id);
    }
  };

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className="glass-card-hover overflow-hidden cursor-pointer group relative hover:border-primary-500/30 hover:shadow-xl hover:shadow-primary-900/30"
      onClick={() => selectInstance(instance)}
    >
      {/* Brillo superior */}
      <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent z-10 pointer-events-none" />
      {/* Banner superior compacto con glow */}
      <div className="relative h-14 bg-gradient-to-br from-primary-600/30 via-dark-800 to-accent-600/30 overflow-hidden">
        {/* Patrón diagonal sutil */}
        <div
          className="absolute inset-0 opacity-[0.15]"
          style={{ backgroundImage: 'repeating-linear-gradient(115deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 7px)' }}
        />
        <motion.div
          className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-primary-500/20 blur-2xl"
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-10 -left-6 w-28 h-28 rounded-full bg-accent-500/20 blur-2xl"
          animate={{ scale: [1.1, 1, 1.1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Badge de estado */}
        <div className="absolute top-2 right-2.5">
          {isRunning ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent-500/25 text-accent-300 border border-accent-500/40 flex items-center gap-1.5 backdrop-blur-sm">
              <motion.span
                className="w-1.5 h-1.5 rounded-full bg-accent-400"
                animate={{ scale: [1, 1.6, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
              EN JUEGO
            </span>
          ) : instance.isInstalled ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 backdrop-blur-sm">
              <CheckCircle size={11} /> LISTA
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-500/15 text-primary-300 border border-primary-500/30 backdrop-blur-sm">
              SIN INSTALAR
            </span>
          )}
        </div>
        {/* Icono flotante */}
        <div className="absolute -bottom-4 left-4">
          <motion.div
            whileHover={{ rotate: 5, scale: 1.05 }}
            className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-600/60 to-accent-600/60 flex items-center justify-center border border-white/20 shadow-lg shadow-black/40 overflow-hidden backdrop-blur-md"
          >
            <InstanceIcon icon={instance.icon} className="text-xl" />
          </motion.div>
        </div>
      </div>

      <div className="px-4 pb-4 pt-6">
        {/* Nombre + descripción */}
        <h3 className="font-bold text-white text-[15px] truncate group-hover:text-primary-200 transition-colors">
          {instance.name}
        </h3>
        <p className="text-dark-400 text-xs mt-0.5 line-clamp-1">
          {instance.description || `Minecraft ${instance.mcVersion}`}
        </p>

        {/* Info de la instancia */}
        <div className="flex flex-wrap gap-1.5 mt-2.5 mb-3">
          <span className="px-2 py-0.5 bg-dark-800 rounded-md text-[11px] text-dark-200 font-semibold">
            MC {instance.mcVersion}
          </span>
          {instance.modLoader !== 'none' ? (
            <span className="px-2 py-0.5 bg-primary-900/50 text-primary-300 rounded-md text-[11px] font-semibold capitalize">
              {instance.modLoader}{instance.modLoaderVersion ? ` ${instance.modLoaderVersion}` : ''}
            </span>
          ) : (
            <span className="px-2 py-0.5 bg-dark-800 rounded-md text-[11px] text-dark-300 font-semibold">
              Vanilla
            </span>
          )}
          <span className="px-2 py-0.5 bg-dark-800 rounded-md text-[11px] text-dark-300 font-semibold">
            Java {instance.javaVersion}
          </span>
          <span className="px-2 py-0.5 bg-dark-800 rounded-md text-[11px] text-dark-300 font-semibold">
            RAM {instance.ramMax}
          </span>
          <span className="px-2 py-0.5 bg-accent-900/50 text-accent-300 rounded-md text-[11px] font-semibold flex items-center gap-1">
            <Package size={10} />
            {instance.mods.length} mods
          </span>
          {instance.serverAddress && (
            <span className="px-2 py-0.5 bg-dark-800 text-dark-300 rounded-md text-[11px] font-semibold flex items-center gap-1">
              <Server size={10} />
              Servidor
            </span>
          )}
        </div>

        {/* Botón Jugar / Instalar */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={(e) => {
            e.stopPropagation();
            handleAction();
          }}
          disabled={isBusy}
          className={`w-full py-2 rounded-xl font-bold text-[13px] flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-wait ${
            isRunning
              ? 'bg-accent-500 text-white shadow-lg shadow-accent-500/30'
              : instance.isInstalled
                ? 'bg-gradient-to-r from-accent-600 to-accent-500 hover:from-accent-500 hover:to-accent-400 text-white shadow-lg shadow-accent-500/25'
                : 'bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 text-white shadow-lg shadow-primary-500/25'
          }`}
        >
          {isBusy ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              {isInstalling ? 'Instalando...' : 'Iniciando...'}
            </>
          ) : isRunning ? (
            <>
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> En juego
            </>
          ) : instance.isInstalled ? (
            <>
              <Play size={15} fill="currentColor" /> Jugar
            </>
          ) : (
            <>
              <Download size={15} /> Instalar
            </>
          )}
        </motion.button>

        {instance.lastPlayed && (
          <p className="text-[10px] text-dark-500 mt-1.5 text-center">
            Último juego: {new Date(instance.lastPlayed).toLocaleDateString('es')}
          </p>
        )}
      </div>
    </motion.div>
  );
}
