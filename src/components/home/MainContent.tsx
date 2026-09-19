import { motion, AnimatePresence } from 'framer-motion';
import { useInstanceStore } from '@/stores/instanceStore';
import { InstanceCard } from '@/components/home/InstanceCard';
import { InstanceDetail } from '@/components/instance/InstanceDetail';
import { ContentBrowser } from '@/components/content/ContentBrowser';
import { SkinStudio } from '@/components/skins/SkinStudio';
import { Package, Shield, Zap, Server, Download, Layers, Gamepad2, Sparkles, Megaphone, X } from 'lucide-react';
import { AnimatedLogo } from '@/components/common/AnimatedLogo';

export function MainContent() {
  const instances = useInstanceStore((s) => s.instances);
  const selectedInstance = useInstanceStore((s) => s.selectedInstance);
  const activeTab = useInstanceStore((s) => s.activeTab);
  const launcherState = useInstanceStore((s) => s.launcherState);
  const activeNotice = useInstanceStore((s) => s.activeNotice);
  const dismissNotice = useInstanceStore((s) => s.dismissNotice);

  if (selectedInstance) {
    return <InstanceDetail key={selectedInstance.id} />;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Status bar */}
      {(launcherState.isLaunching || launcherState.isInstalling) && (
        <div className="px-6 py-2 bg-primary-600/10 border-b border-primary-500/20">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
            <p className="text-xs text-primary-300">{launcherState.statusMessage}</p>
          </div>
          {launcherState.downloadProgress && (
            <div className="mt-1.5">
              <div className="h-1 bg-dark-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-primary-500 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${launcherState.downloadProgress.percentage}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <p className="text-[10px] text-dark-400 mt-0.5">
                {launcherState.downloadProgress.fileName} — {launcherState.downloadProgress.percentage.toFixed(0)}%
              </p>
            </div>
          )}
        </div>
      )}

      {launcherState.error && (
        <div className="px-6 py-2 bg-red-500/10 border-b border-red-500/20">
          <p className="text-xs text-red-400">{launcherState.error}</p>
        </div>
      )}

      {activeNotice && (
        <div className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/25 flex items-center gap-2">
          <Megaphone size={14} className="text-amber-400 shrink-0" />
          <p className="text-xs text-amber-200 flex-1 min-w-0">
            <span className="font-bold">{activeNotice.title}</span>
            {activeNotice.body && <span className="text-amber-200/80"> — {activeNotice.body}</span>}
          </p>
          <button onClick={dismissNotice} className="p-1 hover:bg-white/5 rounded-lg text-dark-400 hover:text-white transition-colors" title="Descartar">
            <X size={13} />
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {activeTab === 'instances' ? (
          <motion.div
            key="instances"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex-1 overflow-y-auto p-6 relative"
          >
            {instances.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center max-w-lg">
                  <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 3, repeat: Infinity }}
                    className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-dark-900/60 border border-primary-500/20 flex items-center justify-center shadow-lg shadow-primary-500/10 overflow-hidden">
                    <AnimatedLogo size={48} />
                  </motion.div>
                  <h3 className="text-lg font-bold text-white mb-2">No hay instancias configuradas</h3>
                  <p className="text-dark-400 text-sm mb-6">El administrador necesita crear al menos una instancia para comenzar a jugar.</p>

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { icon: Package, label: 'Mods', desc: 'Instala desde Modrinth o CurseForge' },
                      { icon: Layers, label: 'Modpacks', desc: 'Packs completos listos para jugar' },
                      { icon: Server, label: 'Servidores', desc: 'Conexión automática configurada' },
                    ].map((feat, i) => (
                      <motion.div key={feat.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 + i * 0.1 }}
                        className="glass-card p-3 text-center">
                        <feat.icon size={18} className="text-dark-400 mx-auto mb-1.5" />
                        <p className="text-xs font-semibold text-white">{feat.label}</p>
                        <p className="text-[10px] text-dark-500 mt-0.5">{feat.desc}</p>
                      </motion.div>
                    ))}
                  </div>

                  <div className="flex items-center justify-center gap-3 mt-6">
                    {[Shield, Zap, Download, Package].map((Icon, i) => (
                      <motion.div key={i} animate={{ opacity: [0.3, 0.7, 0.3], scale: [0.9, 1.1, 0.9] }}
                        transition={{ duration: 2 + i * 0.5, repeat: Infinity, delay: i * 0.3 }}
                        className="w-8 h-8 rounded-lg bg-dark-800/50 flex items-center justify-center border border-dark-700/30">
                        <Icon size={14} className="text-dark-500" />
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              </div>
            ) : (
              <>
                {/* Fondo ambiental */}
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-primary-600/10 blur-3xl" />
                  <div className="absolute top-1/3 -right-24 w-96 h-96 rounded-full bg-accent-600/10 blur-3xl" />
                </div>
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative flex items-center justify-between mb-6"
                >
                  <div className="flex items-center gap-3.5">
                    <motion.div
                      initial={{ scale: 0.85, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                      className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-600 flex items-center justify-center shadow-lg shadow-primary-600/30 shrink-0"
                    >
                      <Gamepad2 size={22} className="text-white" />
                    </motion.div>
                    <div>
                      <h2 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
                        Mis instancias
                        <Sparkles size={15} className="text-primary-400" />
                      </h2>
                      <p className="text-xs text-dark-400 mt-0.5">
                        {instances.length} instancia{instances.length === 1 ? '' : 's'} ·{' '}
                        <span className="text-emerald-300 font-semibold">
                          {instances.filter((i) => i.isInstalled).length} lista{instances.filter((i) => i.isInstalled).length === 1 ? '' : 's'} para jugar
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-dark-800/70 border border-white/10 shadow-md backdrop-blur-sm">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[11px] font-semibold text-dark-200">Sistema en línea</span>
                  </div>
                </motion.div>
                <div className="relative grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {instances.map((instance, i) => (
                    <motion.div
                      key={instance.id}
                      initial={{ opacity: 0, y: 24, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ delay: i * 0.07, type: 'spring', stiffness: 220, damping: 22 }}
                    >
                      <InstanceCard instance={instance} />
                    </motion.div>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        ) : activeTab === 'content' ? (
          <motion.div
            key="content"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex-1 overflow-hidden"
          >
            <ContentBrowser />
          </motion.div>
        ) : (
          <motion.div
            key="skins"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex-1 overflow-hidden"
          >
            <SkinStudio />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
