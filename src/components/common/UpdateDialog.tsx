import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Rocket, Download, Loader2, X, CheckCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { useInstanceStore } from '@/stores/instanceStore';

interface UpdateInfo {
  version: string;
  notes: string;
  installerUrl: string;
  currentVersion: string;
}

type Phase = 'checking' | 'available' | 'downloading' | 'restarting' | 'done';

export function UpdateDialog() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  const [error, setError] = useState('');
  const downloadProgress = useInstanceStore((s) => s.launcherState.downloadProgress);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = await invoke<string>('get_update_url');
        if (!url || cancelled) return;
        const data = await invoke<UpdateInfo>('check_update_info', { url });
        if (cancelled) return;
        const current = await getVersion();
        const newer = await invoke<boolean>('is_update_newer', {
          remote: data.version,
          current,
        });
        if (!cancelled && newer) {
          setInfo(data);
          setPhase('available');
        }
      } catch {
        // Sin URL configurada o sin red: no molestar al usuario
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpdate = async () => {
    if (!info) return;
    setError('');
    setPhase('downloading');
    try {
      const localPath = await invoke<string>('download_update', {
        installerUrl: info.installerUrl,
      });
      setPhase('restarting');
      await invoke('apply_update_and_restart', { installerPath: localPath });
      setPhase('done');
    } catch (e) {
      setError(String(e));
      setPhase('available');
    }
  };

  const visible = info !== null && phase !== 'checking';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 16 }}
            className="glass-card w-full max-w-md p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-500 to-accent-600 flex items-center justify-center shadow-lg shadow-primary-600/25 shrink-0">
                <Rocket size={20} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-white text-sm">Nueva actualización disponible</h3>
                <p className="text-[11px] text-dark-400 font-mono">v{info.version}</p>
              </div>
              {(phase === 'available') && (
                <button onClick={() => setInfo(null)} className="btn-ghost p-1.5" title="Más tarde">
                  <X size={15} />
                </button>
              )}
            </div>

            {info.notes && (
              <div className="bg-dark-800/60 border border-white/5 rounded-lg p-3 mb-4 max-h-40 overflow-y-auto">
                <p className="text-xs text-dark-200 whitespace-pre-wrap">{info.notes}</p>
              </div>
            )}

            {(phase === 'downloading' || phase === 'restarting' || phase === 'done') && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-1.5">
                  {(phase === 'done') ? (
                    <CheckCircle size={13} className="text-accent-400" />
                  ) : (
                    <Loader2 size={13} className="animate-spin text-primary-400" />
                  )}
                  <p className="text-[11px] text-primary-300">
                    {phase === 'downloading'
                      ? `Descargando actualización${downloadProgress ? ` — ${downloadProgress.percentage.toFixed(0)}%` : '...'}`
                      : phase === 'restarting'
                        ? 'Instalando y reiniciando...'
                        : '¡Listo!'}
                  </p>
                </div>
                {phase === 'downloading' && (
                  <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full"
                      animate={{ width: `${downloadProgress?.percentage ?? 0}%` }}
                      transition={{ duration: 0.2 }}
                    />
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

            {phase === 'available' && (
              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setInfo(null)}
                  className="btn-secondary flex-1"
                >
                  Más tarde
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleUpdate}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  <Download size={14} /> Actualizar ahora
                </motion.button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
