import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Play, Download, Server, Cpu, Package, ToggleLeft, ToggleRight,
  Trash2, Plus, Store, FileText, AlertTriangle, CheckCircle, Terminal,
  HardDrive, Layers, Sparkles, Folder, Sun, RefreshCw, Link2, CloudDownload,
} from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { open } from '@tauri-apps/plugin-dialog';
import { InstanceIcon } from '@/components/common/InstanceIcon';

type DetailTab = 'overview' | 'mods' | 'logs' | 'resources' | 'shaders';

export function InstanceDetail() {
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const { selectedInstance, selectInstance, play, installInstance, launcherState, addModToLocal, removeMod, toggleMod, runningInstanceId, setActiveTab, updateInstance, resolveModIcons, setModsSourceUrl, clearModsSource, syncModsSource } = useInstanceStore();

  if (!selectedInstance) return null;

  const instance = selectedInstance;
  const [ramMin, setRamMin] = useState(instance.ramMin);
  const [ramMax, setRamMax] = useState(instance.ramMax);
  const [ramSaved, setRamSaved] = useState(false);

  const isRunning = runningInstanceId === instance.id;
  const isBusy = launcherState.isLaunching || launcherState.isInstalling;
  const canClick = !isBusy && (!runningInstanceId || runningInstanceId === instance.id);

  const handlePlay = () => {
    if (instance.isInstalled) play(instance.id);
    else installInstance(instance.id);
  };

  const handleSaveRam = async () => {
    await updateInstance(instance.id, { ramMin, ramMax });
    setRamSaved(true);
    setTimeout(() => setRamSaved(false), 2000);
  };

  const handleAddMod = async () => {
    const selected = await open({ multiple: true, filters: [{ name: 'Minecraft Mods', extensions: ['jar'] }] });
    if (selected) {
      const files = Array.isArray(selected) ? selected : [selected];
      for (const file of files) await addModToLocal(instance.id, file);
    }
  };

  const [resolvingIcons, setResolvingIcons] = useState(false);
  const [iconsMsg, setIconsMsg] = useState('');

  const [modsUrl, setModsUrl] = useState(instance.modsSource?.archiveUrl ?? '');
  const [modsMsg, setModsMsg] = useState('');
  const [syncingMods, setSyncingMods] = useState(false);
  const activeModsSource = instance.modsSource && instance.modsSource.type !== 'none'
    ? instance.modsSource
    : null;
  const isOfficialPack = !!instance.official;

  const handleSaveModsUrl = async () => {
    setModsMsg('');
    const url = modsUrl.trim();
    if (!url) {
      setModsMsg('Pega primero el enlace del pack de mods.');
      return;
    }
    try {
      await setModsSourceUrl(instance.id, url);
      setModsMsg('Fuente guardada. Al darle a Jugar se sincronizará sola.');
    } catch (e) {
      setModsMsg(String(e));
    }
  };

  const handleSyncModsNow = async () => {
    setModsMsg('');
    setSyncingMods(true);
    try {
      const changed = await syncModsSource(instance.id);
      setModsMsg(changed ? 'Mods sincronizados con el pack del servidor.' : 'Ya estabas al día, sin cambios.');
    } catch (e) {
      setModsMsg(String(e));
    } finally {
      setSyncingMods(false);
    }
  };

  const handleClearModsSource = async () => {
    setModsMsg('');
    try {
      await clearModsSource(instance.id);
      setModsUrl('');
      setModsMsg('Fuente eliminada. Tus mods actuales se conservan.');
    } catch (e) {
      setModsMsg(String(e));
    }
  };

  const handleResolveIcons = async () => {
    setResolvingIcons(true);
    setIconsMsg('');
    try {
      const n = await resolveModIcons(instance.id);
      setIconsMsg(n > 0 ? `Se encontraron ${n} icono${n === 1 ? '' : 's'}.` : 'No se encontraron iconos nuevos.');
    } catch (e) {
      setIconsMsg(String(e));
    } finally {
      setResolvingIcons(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="h-full flex flex-col bg-dark-950 text-white"
    >
      {/* Header */}
      <div className={`relative px-6 py-4 border-b border-white/5 bg-gradient-to-r from-dark-900/90 via-dark-900/50 to-transparent backdrop-blur-md ${isRunning ? 'border-accent-500/30' : ''}`}>
        {isRunning && (
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-accent-500/10 via-transparent to-transparent pointer-events-none"
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => selectInstance(null)}
              className="p-2 rounded-xl bg-dark-800/80 hover:bg-dark-700 text-dark-300 hover:text-white border border-white/5 transition-all shadow-md"
            >
              <ArrowLeft size={17} />
            </motion.button>

            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-600/40 via-dark-800 to-accent-600/40 flex items-center justify-center border border-white/10 shadow-lg overflow-hidden shrink-0"
            >
              <InstanceIcon icon={instance.icon} className="text-xl" />
            </motion.div>

            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-extrabold tracking-tight truncate bg-gradient-to-r from-white via-dark-100 to-dark-300 bg-clip-text text-transparent">
                  {instance.name}
                </h1>
                {isRunning ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="px-2.5 py-0.5 bg-accent-500/20 text-accent-400 border border-accent-500/30 rounded-full text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                  >
                    <motion.div className="w-2 h-2 rounded-full bg-accent-400" animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1, repeat: Infinity }} />
                    En ejecución
                  </motion.span>
                ) : instance.isInstalled ? (
                  <span className="px-2.5 py-0.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 rounded-full text-xs font-medium">
                    Instalada
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 bg-primary-500/15 text-primary-300 border border-primary-500/25 rounded-full text-xs font-medium">
                    Pendiente instalación
                  </span>
                )}
              </div>
              <p className="text-xs text-dark-400 flex items-center gap-2 mt-1 font-medium">
                <span className="text-primary-300 font-semibold">Minecraft {instance.mcVersion}</span>
                {instance.modLoader !== 'none' && (
                  <>
                    <span className="text-dark-600">•</span>
                    <span className="capitalize">{instance.modLoader} {instance.modLoaderVersion}</span>
                  </>
                )}
                <span className="text-dark-600">•</span>
                <span>{instance.mods.length} mods instalados</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveTab('content')}
              className="px-3.5 py-2 rounded-xl bg-dark-800/80 hover:bg-dark-700 text-dark-200 border border-white/10 text-xs font-semibold flex items-center gap-2 transition-all shadow-md"
            >
              <Store size={14} className="text-primary-400" /> Contenido
            </motion.button>

            <motion.button
              whileHover={{ scale: canClick ? 1.03 : 1 }}
              whileTap={{ scale: canClick ? 0.97 : 1 }}
              onClick={handlePlay}
              disabled={!canClick}
              className={`px-5 py-2 rounded-xl font-bold text-[13px] flex items-center gap-2 transition-all shadow-lg disabled:opacity-55 disabled:cursor-not-allowed ${
                isRunning
                  ? 'bg-accent-600 hover:bg-accent-500 text-white shadow-accent-600/30'
                  : instance.isInstalled
                    ? 'bg-gradient-to-r from-accent-600 to-primary-600 hover:from-accent-500 hover:to-primary-500 text-white shadow-accent-600/25'
                    : 'bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 text-white shadow-primary-600/25'
              }`}
            >
              {isRunning ? (
                <>
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
                    <CheckCircle size={17} />
                  </motion.div>
                  En Juego
                </>
              ) : instance.isInstalled ? (
                <>
                  <Play size={17} fill="currentColor" /> Jugar
                </>
              ) : (
                <>
                  <Download size={17} /> Instalar
                </>
              )}
            </motion.button>
          </div>
        </div>
      </div>

      {/* Error & progress alerts */}
      {launcherState.error && (
        <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="px-8 py-3 bg-red-500/10 border-b border-red-500/20 flex items-center gap-3">
          <AlertTriangle size={16} className="text-red-400 shrink-0" />
          <p className="text-xs text-red-300 font-medium flex-1">{launcherState.error}</p>
          {!instance.isInstalled && !isBusy && (
            <button
              onClick={() => installInstance(instance.id)}
              className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30 text-xs font-bold transition-all shrink-0"
            >
              Reintentar instalación
            </button>
          )}
        </motion.div>
      )}

      {(launcherState.isLaunching || launcherState.isInstalling) && (
        <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="px-8 py-3 bg-primary-600/15 border-b border-primary-500/25">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2.5">
              <motion.div className="w-2.5 h-2.5 rounded-full bg-primary-400" animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1, repeat: Infinity }} />
              <p className="text-xs font-semibold text-primary-200">{launcherState.statusMessage}</p>
            </div>
            {launcherState.downloadProgress && (
              <span className="text-xs font-mono font-bold text-primary-300">
                {launcherState.downloadProgress.percentage.toFixed(0)}%
              </span>
            )}
          </div>
          {launcherState.downloadProgress && (
            <div className="h-1.5 bg-dark-900/80 rounded-full overflow-hidden border border-white/5">
              <motion.div
                className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full"
                animate={{ width: `${launcherState.downloadProgress.percentage}%` }}
                transition={{ duration: 0.2 }}
              />
            </div>
          )}
        </motion.div>
      )}

      {/* Navigation Tabs */}
      <div className="px-8 flex gap-2 border-b border-white/5 bg-dark-900/30 overflow-x-auto">
        {[
          { id: 'overview' as const, label: 'General e Información', icon: Cpu },
          { id: 'mods' as const, label: `Mods Instalados (${instance.mods.length})`, icon: Package },
          { id: 'logs' as const, label: 'Consola y Logs', icon: FileText },
          { id: 'resources' as const, label: 'Resource Packs', icon: Folder },
          { id: 'shaders' as const, label: 'Shaders', icon: Sun },
        ].map((t) => {
          const isActive = detailTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setDetailTab(t.id)}
              className={`relative flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all duration-200 ${
                isActive ? 'text-white' : 'text-dark-400 hover:text-dark-200'
              }`}
            >
              <t.icon size={16} className={isActive ? 'text-primary-400' : 'text-dark-500'} />
              {t.label}
              {isActive && (
                <motion.div
                  layoutId="activeTabIndicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary-500 to-accent-500 shadow-sm shadow-primary-500/50"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <AnimatePresence mode="wait">
          {detailTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-6 max-w-5xl"
            >
              {/* Info Grid */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-dark-400 mb-1 flex items-center gap-2">
                  <Sparkles size={14} className="text-primary-400" /> Especificaciones de la Instancia
                </h3>
                <p className="text-[11px] text-dark-500 mb-3">Valores que configuraste al crearla</p>
                {instance.description && (
                  <p className="text-xs text-dark-300 bg-dark-800/50 border border-white/5 rounded-xl px-4 py-2.5 mb-3">
                    {instance.description}
                  </p>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: 'Versión Minecraft', value: instance.mcVersion, desc: 'Lanzamiento oficial', icon: Cpu, color: 'from-blue-500/20 to-indigo-500/20 text-blue-400' },
                    { label: 'Mod Loader', value: instance.modLoader !== 'none' ? `${instance.modLoader} ${instance.modLoaderVersion}` : 'Vanilla', desc: 'Gestor de mods', icon: Layers, color: 'from-primary-500/20 to-accent-500/20 text-primary-400' },
                    { label: 'Versión de Java', value: `Java ${instance.javaVersion}`, desc: 'Runtime requerido', icon: Terminal, color: 'from-emerald-500/20 to-teal-500/20 text-emerald-400' },
                    { label: 'Servidor Asociado', value: instance.serverAddress ? `${instance.serverAddress}:${instance.serverPort}` : 'Sin servidor', desc: instance.serverAddress ? 'Conexión rápida' : 'Solo unjugador', icon: Server, color: 'from-purple-500/20 to-pink-500/20 text-purple-400' },
                  ].map((card, idx) => (
                    <motion.div
                      key={card.label}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="glass-card p-4 relative overflow-hidden group hover:border-white/15 transition-all"
                    >
                      <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-white/5 to-transparent rounded-bl-full pointer-events-none transition-transform group-hover:scale-110" />
                      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center mb-3 shadow-inner`}>
                        <card.icon size={18} />
                      </div>
                      <p className="text-[11px] font-medium text-dark-400">{card.label}</p>
                      <p className="text-sm font-bold text-white mt-0.5 truncate">{card.value}</p>
                      <p className="text-[10px] text-dark-500 mt-1">{card.desc}</p>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* JVM Configuration Card */}
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="glass-card p-6 relative overflow-hidden"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center">
                      <HardDrive size={16} />
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-sm">Configuración de Memoria y Rendimiento (JVM)</h4>
                      <p className="text-xs text-dark-400">
                        Base al crear: <span className="text-dark-200 font-mono font-semibold">{instance.ramMin} mín</span> ·{' '}
                        <span className="text-dark-200 font-mono font-semibold">{instance.ramMax} máx</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/5 mb-4">
                  <div className="bg-dark-900/60 p-3.5 rounded-xl border border-white/5">
                    <label className="text-xs text-dark-400 font-medium block mb-1">Memoria RAM Mínima</label>
                    <input
                      type="text"
                      value={ramMin}
                      onChange={(e) => setRamMin(e.target.value)}
                      className="input-field text-sm font-mono"
                      placeholder="2G"
                    />
                  </div>
                  <div className="bg-dark-900/60 p-3.5 rounded-xl border border-white/5">
                    <label className="text-xs text-dark-400 font-medium block mb-1">Memoria RAM Máxima</label>
                    <input
                      type="text"
                      value={ramMax}
                      onChange={(e) => setRamMax(e.target.value)}
                      className="input-field text-sm font-mono"
                      placeholder="4G"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-dark-400 font-mono">Argumentos: {(instance.jvmArgs ?? []).join(' ') || 'Predeterminados'}</span>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSaveRam}
                    className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5"
                  >
                    {ramSaved ? <CheckCircle size={14} className="text-emerald-400" /> : <Sparkles size={14} />}
                    {ramSaved ? '¡RAM Guardada!' : 'Guardar Memoria RAM'}
                  </motion.button>
                </div>
              </motion.div>

              {/* Fuente de mods del servidor */}
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="glass-card p-6 relative overflow-hidden"
              >
                <div className="flex items-center gap-2.5 mb-1">
                  <div className="w-8 h-8 rounded-lg bg-accent-500/20 text-accent-400 flex items-center justify-center">
                    <CloudDownload size={16} />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Mods del servidor</h4>
                    <p className="text-xs text-dark-400">
                      {isOfficialPack ? 'Pack oficial conectado: lo que publique el admin se te instala solo al darle a Jugar.' : 'Pega el enlace del pack y al darle a Jugar se te ponen solos los mods nuevos, se borran los quitados y se actualizan los cambiados.'}
                    </p>
                  </div>
                </div>

                {isOfficialPack && (
                  <div className="mt-3 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2">
                    <CheckCircle size={13} className="text-emerald-400 shrink-0" />
                    <p className="text-[11px] text-emerald-200 font-medium">Conectado al pack oficial</p>
                  </div>
                )}

                {activeModsSource?.type === 'archive' && activeModsSource.archiveUrl && !isOfficialPack && (
                  <div className="mt-3 px-3 py-2 rounded-xl bg-accent-500/10 border border-accent-500/20 flex items-center gap-2">
                    <Link2 size={13} className="text-accent-400 shrink-0" />
                    <p className="text-[11px] text-accent-200 font-mono truncate flex-1">{activeModsSource.archiveUrl}</p>
                    {activeModsSource.syncedAt && (
                      <span className="text-[10px] text-dark-400 shrink-0">
                        Sinc: {new Date(activeModsSource.syncedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex flex-col md:flex-row gap-2 mt-3">
                  <input
                    type="text"
                    value={modsUrl}
                    onChange={(e) => setModsUrl(e.target.value)}
                    placeholder="https://github.com/.../releases/download/.../mods.zip"
                    className="input-field text-xs font-mono flex-1"
                  />
                  <div className="flex gap-2 shrink-0">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleSaveModsUrl}
                      className="btn-primary text-xs py-2 px-4"
                    >
                      Guardar
                    </motion.button>
                    {activeModsSource && (
                      <>
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={handleSyncModsNow}
                          disabled={syncingMods}
                          className="btn-secondary text-xs py-2 px-4 flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <RefreshCw size={13} className={syncingMods ? 'animate-spin' : ''} />
                          {syncingMods ? 'Sincronizando...' : 'Sincronizar'}
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={handleClearModsSource}
                          className="btn-ghost text-xs py-2 px-3"
                          title="Quitar fuente (conserva tus mods actuales)"
                        >
                          <Trash2 size={13} />
                        </motion.button>
                      </>
                    )}
                  </div>
                </div>
                {modsMsg && <p className="text-xs text-primary-300 mt-2">{modsMsg}</p>}
              </motion.div>
            </motion.div>
          )}

          {detailTab === 'mods' && (
            <motion.div
              key="mods"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="max-w-5xl space-y-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-bold text-white text-sm">Gestión de Mods</h3>
                  <p className="text-xs text-dark-400">Activa, desactiva o añade archivos .jar a tu instancia</p>
                </div>
                <div className="flex items-center gap-2">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleResolveIcons}
                    disabled={resolvingIcons}
                    className="btn-secondary text-xs flex items-center gap-2 py-2 px-4 disabled:opacity-50"
                    title="Busca en Modrinth los iconos de los mods sin icono"
                  >
                    <RefreshCw size={14} className={resolvingIcons ? 'animate-spin' : ''} />
                    {resolvingIcons ? 'Buscando...' : 'Buscar iconos'}
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleAddMod}
                    className="btn-primary text-xs flex items-center gap-2 py-2 px-4 shadow-md shadow-primary-600/20"
                  >
                    <Plus size={14} /> Añadir archivo .jar
                  </motion.button>
                </div>
              </div>
              {iconsMsg && <p className="text-xs text-primary-300 mb-2">{iconsMsg}</p>}

              {instance.mods.length === 0 ? (
                <div className="glass-card p-12 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-dark-800/80 border border-white/5 flex items-center justify-center mx-auto mb-4 text-dark-500">
                    <Package size={28} />
                  </div>
                  <p className="text-white font-semibold text-sm">No hay mods en esta instancia</p>
                  <p className="text-dark-400 text-xs mt-1 max-w-sm mx-auto">
                    Explora la sección de <span className="text-primary-300 font-medium">Contenido</span> para instalar mods directamente o añade archivos `.jar` locales.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {instance.mods.map((mod, index) => (
                    <motion.div
                      key={mod.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className={`glass-card p-4 flex items-center gap-4 transition-all ${
                        mod.enabled ? 'border-white/10 bg-dark-900/60' : 'border-white/5 bg-dark-950/40 opacity-50'
                      }`}
                    >
                      {/* Mod Icon or Fallback Badge */}
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-dark-800 to-dark-900 flex items-center justify-center border border-white/10 overflow-hidden shrink-0 shadow-sm">
                        {mod.iconUrl ? (
                          <img src={mod.iconUrl} alt={mod.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="font-extrabold text-primary-400 text-sm">
                            {mod.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-white text-sm truncate">{mod.name}</h4>
                          {mod.version && (
                            <span className="px-2 py-0.5 bg-primary-500/15 text-primary-300 border border-primary-500/20 rounded text-[10px] font-mono font-semibold">
                              v{mod.version}
                            </span>
                          )}
                          <span className="px-2 py-0.5 bg-dark-800 text-dark-400 rounded text-[10px] uppercase tracking-wider font-bold">
                            {mod.source}
                          </span>
                        </div>
                        <p className="text-xs text-dark-400 font-mono mt-0.5 truncate">{mod.filename}</p>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          onClick={() => toggleMod(instance.id, mod.id)}
                          className="p-1.5 hover:bg-white/5 rounded-lg transition-colors text-dark-400 hover:text-white"
                          title={mod.enabled ? 'Desactivar mod' : 'Activar mod'}
                        >
                          {mod.enabled ? (
                            <ToggleRight size={26} className="text-accent-400" />
                          ) : (
                            <ToggleLeft size={26} className="text-dark-600" />
                          )}
                        </button>
                        <button
                          onClick={() => removeMod(instance.id, mod.id)}
                          className="p-2 hover:bg-red-500/15 rounded-lg transition-colors text-dark-500 hover:text-red-400"
                          title="Eliminar mod"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {detailTab === 'logs' && (
            <motion.div
              key="logs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="max-w-5xl"
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-bold text-white text-sm">Consola y Registro de Ejecución</h3>
                  <p className="text-xs text-dark-400">Salida en tiempo real del proceso de Minecraft</p>
                </div>
              </div>

              <div className="glass-card p-5 font-mono text-xs bg-dark-950/90 text-dark-300 space-y-1.5 border border-white/10 shadow-2xl rounded-2xl">
                <div className="flex items-center gap-2 pb-3 border-b border-white/5 text-dark-400">
                  <Terminal size={14} className="text-primary-400" />
                  <span>LTC Launcher v1.0.0 — Consola de Instancia [{instance.name}]</span>
                </div>
                <p className="text-primary-400">[LTC] Versión de Minecraft: {instance.mcVersion} ({instance.modLoader})</p>
                <p className="text-primary-400">[LTC] Java Runtime: Java {instance.javaVersion}</p>
                <p className="text-primary-400">[LTC] Mods totales: {instance.mods.length} ({instance.mods.filter(m => m.enabled).length} activos)</p>
                <p className="text-dark-600">──────────────────────────────────────────────────────────</p>
                <p className="text-dark-400">[INFO] Esperando inicio de la instancia para capturar salida de Log...</p>
                {isRunning ? (
                  <p className="text-accent-400 flex items-center gap-2 pt-2 font-semibold">
                    <motion.span animate={{ opacity: [1, 0, 1] }} transition={{ duration: 1, repeat: Infinity }} className="text-accent-400">●</motion.span>
                    Proceso de Minecraft activo y corriendo.
                  </p>
                ) : (
                  <p className="text-dark-600 pt-2">Estado del proceso: En espera / Inactivo</p>
                )}
              </div>
            </motion.div>
          )}

          {detailTab === 'resources' && (
            <motion.div
              key="resources"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="max-w-5xl space-y-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-bold text-white text-sm">Resource Packs (Paquetes de Recursos)</h3>
                  <p className="text-xs text-dark-400">Gestiona las texturas y recursos visuales de tu instancia</p>
                </div>
              </div>
              <div className="glass-card p-6 text-center">
                <Folder size={32} className="text-primary-400 mx-auto mb-3" />
                <p className="text-white font-semibold text-sm">Carpeta de Resource Packs</p>
                <p className="text-dark-400 text-xs mt-1 max-w-md mx-auto">
                  Coloca tus archivos `.zip` de resource packs en la carpeta `resourcepacks` de esta instancia.
                </p>
              </div>
            </motion.div>
          )}

          {detailTab === 'shaders' && (
            <motion.div
              key="shaders"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="max-w-5xl space-y-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-bold text-white text-sm">Shaders (Paquetes de Sombras)</h3>
                  <p className="text-xs text-dark-400">Gestiona los gráficos avanzados y shaders (Requiere Iris o Oculus)</p>
                </div>
              </div>
              <div className="glass-card p-6 text-center">
                <Sun size={32} className="text-accent-400 mx-auto mb-3" />
                <p className="text-white font-semibold text-sm">Carpeta de Shaders</p>
                <p className="text-dark-400 text-xs mt-1 max-w-md mx-auto">
                  Coloca tus archivos `.zip` de shaders en la carpeta `shaderpacks` de esta instancia.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}