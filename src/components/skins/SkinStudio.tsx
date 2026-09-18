import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Shirt, Upload, Check, Trash2, Play, Pause, RotateCw, User, Info,
} from 'lucide-react';
import { SkinViewer, WalkingAnimation, IdleAnimation, RunningAnimation } from 'skinview3d';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { useAuthStore } from '@/stores/authStore';
import { useInstanceStore } from '@/stores/instanceStore';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return window.btoa(binary);
}

type AnimKind = 'idle' | 'walk' | 'run' | 'none';

export function SkinStudio() {
  const account = useAuthStore((s) => s.account);
  const savedAccounts = useInstanceStore((s) => s.savedAccounts);
  const setAccountSkin = useInstanceStore((s) => s.setAccountSkin);

  const names = Array.from(new Set([
    ...(account ? [account.username] : []),
    ...savedAccounts.map((a) => a.username),
  ]));
  const [selected, setSelected] = useState(names[0] ?? '');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [skinModel, setSkinModel] = useState<'auto-detect' | 'slim' | 'default'>('auto-detect');
  const [anim, setAnim] = useState<AnimKind>('walk');
  const [playing, setPlaying] = useState(true);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);

  const currentSkin = previewUrl
    ?? savedAccounts.find((a) => a.username === selected)?.skinUrl
    ?? (account?.username === selected ? account.skinUrl : undefined)
    ?? null;

  // Crear el visor 3D una vez
  useEffect(() => {
    if (!canvasRef.current || viewerRef.current) return;
    const viewer = new SkinViewer({
      canvas: canvasRef.current,
      width: 300,
      height: 400,
      preserveDrawingBuffer: false,
    });
    viewer.autoRotate = true;
    viewer.autoRotateSpeed = 1.2;
    viewerRef.current = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  // Cargar skin en el visor cuando cambia
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !currentSkin) return;
    viewer.loadSkin(currentSkin, { model: skinModel }).catch(() => {
      setError('No se pudo cargar la skin en el visor 3D.');
    });
  }, [currentSkin, skinModel]);

  // Animación
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (!playing || anim === 'none') {
      viewer.animation = null;
      return;
    }
    viewer.animation = anim === 'walk'
      ? new WalkingAnimation()
      : anim === 'run'
        ? new RunningAnimation()
        : new IdleAnimation();
    viewer.animation.speed = 0.8;
  }, [anim, playing]);

  useEffect(() => {
    setPreviewUrl(null);
    setInfo('');
    setError('');
    setSaved(false);
  }, [selected]);

  const handleUpload = async () => {
    try {
      setError('');
      const picked = await open({
        multiple: false,
        filters: [{ name: 'Skin de Minecraft', extensions: ['png'] }],
      });
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      const bytes = await readFile(path);
      const dataUrl = `data:image/png;base64,${bytesToBase64(bytes)}`;
      // Validar dimensiones (64x64 moderna o 64x32 clásica)
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.width, h: img.height });
        img.onerror = () => reject(new Error('bad-image'));
        img.src = dataUrl;
      });
      if (!(dims.w === 64 && (dims.h === 64 || dims.h === 32))) {
        setError(`La imagen debe ser de 64x64 o 64x32 píxeles (esta es de ${dims.w}x${dims.h}).`);
        return;
      }
      setPreviewUrl(dataUrl);
      setInfo(`Skin válida de ${dims.w}x${dims.h}. Previsualízala en 3D y pulsa Guardar.`);
    } catch (e) {
      setError(`No se pudo leer la imagen: ${String(e)}`);
    }
  };

  const handleSave = () => {
    if (!selected || !previewUrl) return;
    setAccountSkin(selected, previewUrl);
    useAuthStore.setState((s) => ({
      account: s.account && s.account.username === selected
        ? { ...s.account, skinUrl: previewUrl }
        : s.account,
    }));
    setSaved(true);
    setInfo('Skin guardada para esta cuenta.');
    setTimeout(() => setSaved(false), 2500);
  };

  const handleRemove = () => {
    if (!selected) return;
    setAccountSkin(selected, null);
    useAuthStore.setState((s) => ({
      account: s.account && s.account.username === selected
        ? { ...s.account, skinUrl: undefined }
        : s.account,
    }));
    setPreviewUrl(null);
    setInfo('Skin eliminada, se usará la apariencia por defecto.');
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Shirt size={18} className="text-primary-400" />
          <h2 className="font-bold text-white">Skins</h2>
        </div>
        <p className="text-xs text-dark-400 mt-0.5">
          Sube tu skin desde tu PC, mírala en 3D y guárdala en tu cuenta
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {names.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-dark-500 text-sm">Inicia sesión para gestionar skins.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-5xl mx-auto">
            {/* Visor 3D */}
            <div className="glass-card p-5 flex flex-col items-center">
              <div className="w-[300px] h-[400px] rounded-xl overflow-hidden bg-gradient-to-b from-dark-800/80 to-dark-950 border border-white/10">
                {currentSkin ? (
                  <canvas ref={canvasRef} width={300} height={400} className="w-full h-full" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-center p-6">
                    <User size={40} className="text-dark-600" />
                    <p className="text-dark-400 text-sm">Sin skin para previsualizar</p>
                    <p className="text-dark-500 text-xs">Sube un PNG de 64x64 o 64x32.</p>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 mt-4 flex-wrap justify-center">
                <button
                  onClick={() => setPlaying((p) => !p)}
                  className="btn-ghost p-2"
                  title={playing ? 'Pausar animación' : 'Reproducir animación'}
                >
                  {playing ? <Pause size={15} /> : <Play size={15} />}
                </button>
                {(['idle', 'walk', 'run', 'none'] as AnimKind[]).map((a) => (
                  <button
                    key={a}
                    onClick={() => { setAnim(a); setPlaying(true); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      anim === a ? 'bg-primary-600/25 text-primary-300' : 'text-dark-400 hover:text-dark-200 hover:bg-white/5'
                    }`}
                  >
                    {a === 'idle' ? 'Quieto' : a === 'walk' ? 'Caminar' : a === 'run' ? 'Correr' : 'Sin animación'}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 mt-2 text-xs text-dark-400">
                <RotateCw size={12} />
                <span>Arrastra para girar · la vista rota sola</span>
              </div>
            </div>

            {/* Controles */}
            <div className="space-y-4">
              <div className="glass-card p-5">
                <label className="text-[11px] font-medium text-dark-400 block mb-1.5">Cuenta</label>
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="input-field text-sm"
                >
                  {names.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>

              <div className="glass-card p-5">
                <h3 className="text-sm font-semibold text-white mb-1">Skin desde tu PC</h3>
                <p className="text-[11px] text-dark-500 mb-3">Archivo PNG de 64x64 (moderna) o 64x32 (clásica).</p>
                <div className="flex gap-2 flex-wrap">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleUpload}
                    className="btn-primary text-xs flex items-center gap-2"
                  >
                    <Upload size={13} /> Subir PNG
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleSave}
                    disabled={!previewUrl || !selected}
                    className="btn-secondary text-xs flex items-center gap-2 disabled:opacity-50"
                  >
                    {saved ? <Check size={13} className="text-accent-400" /> : null}
                    {saved ? '¡Guardada!' : 'Guardar skin'}
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleRemove}
                    disabled={!selected}
                    className="btn-danger text-xs flex items-center gap-2 disabled:opacity-50"
                  >
                    <Trash2 size={13} /> Quitar
                  </motion.button>
                </div>

                <div className="mt-3">
                  <label className="text-[11px] font-medium text-dark-400 block mb-1.5">Modelo de brazos</label>
                  <select
                    value={skinModel}
                    onChange={(e) => setSkinModel(e.target.value as typeof skinModel)}
                    className="input-field text-xs"
                  >
                    <option value="auto-detect">Automático</option>
                    <option value="default">Clásico (4px)</option>
                    <option value="slim">Delgado (3px)</option>
                  </select>
                </div>

                {info && <p className="text-xs text-primary-300 mt-3">{info}</p>}
                {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
              </div>

              <div className="glass-card p-5 flex gap-2.5">
                <Info size={15} className="text-primary-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-dark-400 leading-relaxed">
                  Con cuenta Microsoft se usa automáticamente tu skin de Mojang en servidores premium.
                  En servidores no premium tu apariencia la asigna el servidor (plugins tipo SkinsRestorer):
                  esta skin queda guardada en tu cuenta del launcher para usarla donde el servidor lo permita.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
