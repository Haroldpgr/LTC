import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Plus, Trash2, Edit3, Package, Server, Save, X,
  Upload, Gamepad2, Shield, Cpu, ImagePlus, Share2, Rocket,
} from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { InstanceIcon } from '@/components/common/InstanceIcon';
import type { ModpackInstance } from '@/types';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return window.btoa(binary);
}

function mimeForExt(ext: string): string {
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon',
  };
  return map[ext] || 'image/png';
}

type Tab = 'instances' | 'create' | 'edit' | 'update';

const MC_VERSIONS = [
  '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21',
  '1.20.6', '1.20.4', '1.20.2', '1.20.1', '1.20',
  '1.19.4', '1.19.3', '1.19.2', '1.19.1', '1.19',
  '1.18.2', '1.18.1', '1.18',
  '1.17.1', '1.16.5', '1.12.2', '1.8.9', '1.7.10',
];

const FORGE_VERSIONS: Record<string, string> = {
  '1.21.4': '54.0.3', '1.21.3': '53.0.7', '1.21.1': '52.0.29',
  '1.20.6': '50.1.0', '1.20.4': '49.1.0', '1.20.2': '48.1.0',
  '1.20.1': '47.4.10', '1.20': '46.0.14',
  '1.19.4': '45.3.0', '1.19.3': '44.1.23', '1.19.2': '43.4.0',
  '1.18.2': '40.2.21', '1.17.1': '37.1.2', '1.16.5': '36.2.28',
  '1.12.2': '14.23.5.2860', '1.8.9': '11.15.1.2318', '1.7.10': '10.13.4.1614',
};

const FABRIC_VERSIONS: Record<string, string> = {
  '1.21.4': '0.16.10', '1.21.3': '0.16.9', '1.21.1': '0.16.5',
  '1.20.6': '0.15.11', '1.20.4': '0.15.7', '1.20.1': '0.15.3',
  '1.19.4': '0.14.24', '1.19.2': '0.14.21', '1.18.2': '0.14.8',
  '1.17.1': '0.11.7', '1.16.5': '0.11.7',
};

function getJavaVersion(mcVersion: string): number {
  const parts = mcVersion.split('.').map(Number);
  const minor = parts[1] ?? 0;
  if (minor >= 20) return 21;
  if (minor >= 17) return 17;
  if (minor >= 12) return 8;
  return 8;
}

function getLoaderVersion(loader: string, mcVersion: string): string {
  if (loader === 'forge') return FORGE_VERSIONS[mcVersion] || '47.4.10';
  if (loader === 'fabric') return FABRIC_VERSIONS[mcVersion] || '0.15.3';
  return '';
}

export function AdminPanel() {
  const { instances, createInstance, updateInstance, deleteInstance, addModToLocal, removeMod, adminLogout } = useInstanceStore();
  const [tab, setTab] = useState<Tab>('instances');
  const [editingInstance, setEditingInstance] = useState<ModpackInstance | null>(null);
  const [iconError, setIconError] = useState('');
  const [loaderOptions, setLoaderOptions] = useState<{ version: string; stable?: boolean }[]>([]);
  const [loadingLoaders, setLoadingLoaders] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [updateUrl, setUpdateUrl] = useState('');
  const [updateCheck, setUpdateCheck] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [form, setForm] = useState({
    name: '', description: '', icon: '⛏️', mcVersion: '1.20.1',
    modLoader: 'forge' as 'forge' | 'fabric' | 'none', modLoaderVersion: '47.4.10',
    javaVersion: 17, ramMin: '4G', ramMax: '4G', jvmArgs: '',
    serverAddress: '', serverPort: 25565,
  });

  const resetForm = () => {
    setForm({ name: '', description: '', icon: '⛏️', mcVersion: '1.20.1', modLoader: 'forge',
      modLoaderVersion: '47.4.10', javaVersion: 17, ramMin: '4G', ramMax: '4G', jvmArgs: '',
      serverAddress: '', serverPort: 25565 });
    setEditingInstance(null);
  };

  const handleMcVersionChange = (mcVersion: string) => {
    const java = getJavaVersion(mcVersion);
    const loaderVer = getLoaderVersion(form.modLoader, mcVersion);
    setForm({ ...form, mcVersion, javaVersion: java, modLoaderVersion: loaderVer });
  };

  const handleLoaderChange = (modLoader: 'forge' | 'fabric' | 'none') => {
    const loaderVer = getLoaderVersion(modLoader, form.mcVersion);
    setForm({ ...form, modLoader, modLoaderVersion: loaderVer });
  };

  useEffect(() => {
    if (tab === 'update') loadUpdateSettings();
  }, [tab]);

  // Lista de versiones del loader para el MC elegido (solo al crear/editar)
  useEffect(() => {
    if (tab !== 'create' && tab !== 'edit') return;
    if (form.modLoader === 'none') {
      setLoaderOptions([]);
      return;
    }
    let cancelled = false;
    setLoadingLoaders(true);
    (async () => {
      try {
        if (form.modLoader === 'forge') {
          const list = await invoke<string[]>('list_forge_versions', { mcVersion: form.mcVersion });
          if (!cancelled) setLoaderOptions(list.map((version) => ({ version })));
        } else {
          const list = await invoke<{ version: string; stable: boolean }[]>('list_fabric_versions', { mcVersion: form.mcVersion });
          if (!cancelled) setLoaderOptions(list);
        }
      } catch {
        if (!cancelled) setLoaderOptions([]);
      }
      if (!cancelled) setLoadingLoaders(false);
    })();
    return () => { cancelled = true; };
  }, [tab, form.mcVersion, form.modLoader]);

  const handleSave = async () => {
    const data = {
      name: form.name, description: form.description, icon: form.icon,
      mcVersion: form.mcVersion, modLoader: form.modLoader, modLoaderVersion: form.modLoaderVersion,
      javaVersion: form.javaVersion, ramMin: form.ramMin, ramMax: form.ramMax,
      jvmArgs: form.jvmArgs.split(' ').filter(Boolean), serverAddress: form.serverAddress,
      serverPort: form.serverPort, mods: editingInstance?.mods ?? [],
      isInstalled: editingInstance?.isInstalled ?? false, isUpdating: false,
    };
    if (editingInstance) await updateInstance(editingInstance.id, data);
    else await createInstance(data);
    resetForm();
    setTab('instances');
  };

  const handleEdit = (instance: ModpackInstance) => {
    setEditingInstance(instance);
    setForm({
      name: instance.name ?? '', description: instance.description ?? '', icon: instance.icon ?? '⛏️',
      mcVersion: instance.mcVersion ?? '1.20.1',
      modLoader: (instance.modLoader as 'forge' | 'fabric' | 'none') ?? 'forge',
      modLoaderVersion: instance.modLoaderVersion ?? '',
      javaVersion: instance.javaVersion ?? 17,
      ramMin: instance.ramMin ?? '4G', ramMax: instance.ramMax ?? '4G',
      jvmArgs: (instance.jvmArgs ?? []).join(' '),
      serverAddress: instance.serverAddress ?? '', serverPort: instance.serverPort ?? 25565,
    });
    setTab('edit');
  };

  const handlePickIcon = async () => {
    try {
      setIconError('');
      const selected = await open({ multiple: false, filters: [{ name: 'Imagen', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }] });
      if (!selected) return;
      const path = Array.isArray(selected) ? selected[0] : selected;
      const bytes = await readFile(path);
      if (bytes.byteLength > 2_500_000) {
        setIconError('La imagen supera los 2.5 MB. Usa una imagen más pequeña.');
        return;
      }
      const ext = path.split('.').pop()?.toLowerCase() || 'png';
      setForm({ ...form, icon: `data:${mimeForExt(ext)};base64,${bytesToBase64(bytes)}` });
    } catch (e) {
      setIconError(String(e));
    }
  };

  const handleAddMod = async (instanceId: string) => {
    const selected = await open({ multiple: true, filters: [{ name: 'Mods', extensions: ['jar'] }] });
    if (selected) {
      for (const file of (Array.isArray(selected) ? selected : [selected])) {
        await addModToLocal(instanceId, file);
      }
    }
  };

  const handleExportPack = async (instanceId: string) => {
    setExportMsg('');
    setExportingId(instanceId);
    try {
      const path = await invoke<string>('export_mods_archive', { instanceId });
      setExportMsg(`Pack exportado: ${path}. Súbelo como mods.zip al release de tag mods-latest y les llegará solo a todos al darle a Jugar.`);
    } catch (e) {
      setExportMsg(String(e));
    }
    setExportingId(null);
  };

  const loadUpdateSettings = async () => {
    try {
      setAppVersion(await getVersion());
    } catch { /* noop */ }
    try {
      setUpdateUrl(await invoke<string>('get_update_url'));
    } catch { /* noop */ }
  };

  const handleSaveUpdateUrl = async () => {
    try {
      await invoke('set_update_url', { url: updateUrl });
      setUpdateCheck('URL de actualizaciones guardada.');
    } catch (e) {
      setUpdateCheck(String(e));
    }
  };

  const handleCheckUpdate = async () => {
    if (!updateUrl.trim()) {
      setUpdateCheck('Primero configura y guarda la URL del JSON.');
      return;
    }
    setCheckingUpdate(true);
    setUpdateCheck('');
    try {
      const info = await invoke<{ version: string; notes: string; installerUrl: string }>('check_update_info', { url: updateUrl.trim() });
      const newer = await invoke<boolean>('is_update_newer', { remote: info.version, current: appVersion || '0.0.0' });
      setUpdateCheck(newer
        ? `Hay versión nueva: v${info.version}. Los usuarios la verán al abrir el launcher.`
        : `El JSON responde v${info.version}: no es más nueva que v${appVersion}.`);
    } catch (e) {
      setUpdateCheck(String(e));
    }
    setCheckingUpdate(false);
  };

  const tabs = [
    { id: 'instances' as const, label: 'Instancias', icon: Gamepad2 },
    { id: 'create' as const, label: 'Nueva', icon: Plus },
    { id: 'update' as const, label: 'Info de update', icon: Rocket },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col w-full">
      {/* Header */}
      <header className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-primary-600/5 to-transparent">
        <div className="flex items-center gap-3">
          <motion.button whileTap={{ scale: 0.95 }} onClick={adminLogout} className="btn-ghost p-2">
            <ArrowLeft size={18} />
          </motion.button>
          <div className="w-9 h-9 rounded-lg bg-primary-600/20 flex items-center justify-center">
            <Shield size={16} className="text-primary-400" />
          </div>
          <div>
            <h2 className="font-bold text-white text-sm">Panel de Administración</h2>
            <p className="text-[11px] text-dark-400">Configura instancias, mods y servidor</p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="px-6 pt-3 flex gap-1 border-b border-white/5">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => { if (t.id === 'create') resetForm(); setTab(t.id === 'create' && tab === 'edit' ? 'edit' : t.id); }}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-all ${
              (tab === t.id || (t.id === 'create' && tab === 'edit')) ? 'border-primary-500 text-white' : 'border-transparent text-dark-400 hover:text-dark-200'
            }`}>
            <t.icon size={14} />{t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <AnimatePresence mode="wait">
          {tab === 'instances' && (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-dark-400">{instances.length} instancias</p>
                <motion.button whileTap={{ scale: 0.95 }} onClick={() => { resetForm(); setTab('create'); }}
                  className="btn-primary text-xs flex items-center gap-1.5 py-2">
                  <Plus size={14} /> Crear Instancia
                </motion.button>
              </div>
              {exportMsg && (
                <p className="text-xs text-primary-300 bg-primary-500/10 border border-primary-500/20 rounded-lg px-3 py-2 break-all">
                  {exportMsg}
                </p>
              )}

              {instances.map((inst, i) => (
                <motion.div key={inst.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  className="glass-card p-4 hover:bg-white/[0.04] transition-all">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-600/30 to-accent-600/30 flex items-center justify-center border border-white/10 overflow-hidden shrink-0">
                      <InstanceIcon icon={inst.icon} className="text-xl" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-white text-sm">{inst.name}</h4>
                      <p className="text-[11px] text-dark-400 mt-0.5">
                        MC {inst.mcVersion} · {inst.modLoader} · {inst.mods.length} mods
                        {inst.serverAddress && ` · ${inst.serverAddress}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <motion.button whileTap={{ scale: 0.9 }} onClick={() => handleAddMod(inst.id)}
                        className="btn-secondary text-xs flex items-center gap-1 py-1.5 px-3">
                        <Upload size={12} /> Mods
                      </motion.button>
                      <motion.button whileTap={{ scale: 0.9 }} onClick={() => handleExportPack(inst.id)}
                        disabled={exportingId === inst.id}
                        title="Exportar los mods a un zip para compartirlo como Fuente de mods"
                        className="btn-secondary text-xs flex items-center gap-1 py-1.5 px-3 disabled:opacity-50">
                        <Share2 size={12} /> {exportingId === inst.id ? 'Exportando...' : 'Publicar'}
                      </motion.button>
                      <motion.button whileTap={{ scale: 0.9 }} onClick={() => handleEdit(inst)} className="btn-ghost p-2">
                        <Edit3 size={15} />
                      </motion.button>
                      <motion.button whileTap={{ scale: 0.9 }} onClick={() => deleteInstance(inst.id)} className="btn-danger p-2">
                        <Trash2 size={15} />
                      </motion.button>
                    </div>
                  </div>
                  {inst.mods.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap gap-1.5">
                      {inst.mods.slice(0, 8).map((mod) => (
                        <span key={mod.id} className="flex items-center gap-1 px-2 py-0.5 bg-dark-800/80 rounded text-[10px] text-dark-300">
                          <Package size={9} />{mod.name}
                          <span onClick={() => removeMod(inst.id, mod.id)} className="hover:text-red-400 cursor-pointer ml-0.5">
                            <X size={9} />
                          </span>
                        </span>
                      ))}
                      {inst.mods.length > 8 && (
                        <span className="text-[10px] text-dark-500 py-0.5">+{inst.mods.length - 8} más</span>
                      )}
                    </div>
                  )}
                </motion.div>
              ))}
            </motion.div>
          )}

          {tab === 'update' && (
            <motion.div key="update" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-2xl space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-600 flex items-center justify-center shadow-lg shadow-primary-600/25 shrink-0">
                  <Rocket size={18} className="text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Info de update</h3>
                  <p className="text-xs text-dark-400">
                    Versión instalada: <span className="font-mono text-primary-300">v{appVersion || '...'}</span>
                  </p>
                </div>
              </div>

              <div className="glass-card p-5 space-y-3">
                <div>
                  <label className="text-[11px] font-medium text-dark-400 block mb-1.5">
                    URL del JSON de actualización (lo ven todos los usuarios)
                  </label>
                  <input
                    type="text"
                    value={updateUrl}
                    onChange={(e) => setUpdateUrl(e.target.value)}
                    placeholder="https://tu-host.com/ltc/update.json"
                    className="input-field text-xs font-mono"
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  <motion.button whileTap={{ scale: 0.97 }} onClick={handleSaveUpdateUrl} className="btn-primary text-xs flex items-center gap-2">
                    <Save size={13} /> Guardar URL
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.97 }} onClick={handleCheckUpdate} disabled={checkingUpdate} className="btn-secondary text-xs flex items-center gap-2 disabled:opacity-50">
                    {checkingUpdate ? 'Comprobando...' : 'Comprobar ahora'}
                  </motion.button>
                </div>
                {updateCheck && <p className="text-xs text-primary-300">{updateCheck}</p>}
              </div>

              <div className="glass-card p-5">
                <h4 className="text-sm font-semibold text-white mb-2">Cómo publicar una update (gratis con GitHub)</h4>
                <ol className="text-xs text-dark-400 space-y-1.5 list-decimal list-inside">
                  <li>Prepara los cambios y ejecuta <span className="font-mono text-primary-300">npm run publish:update -- "Notas"</span>: compila el instalador y genera el <span className="font-mono">update.json</span> junto a él.</li>
                  <li>Crea cuenta gratis en <span className="font-mono text-primary-300">github.com</span> y un repositorio (ej. ltc-updates). Sin tarjeta, y admite archivos de hasta 2 GB.</li>
                  <li>En el repo: <span className="font-mono">Releases &gt; Create a new release</span>, tag <span className="font-mono">v{appVersion || 'x.y.z'}</span>, y sube el <span className="font-mono">.exe</span>.</li>
                  <li>Edita <span className="font-mono">update.json</span> con la URL del .exe (<span className="font-mono">.../releases/download/vX/archivo.exe</span>) y súbelo al mismo release.</li>
                  <li>Pega arriba la URL pública del <span className="font-mono">update.json</span> y guárdala.</li>
                  <li>A los usuarios les saldrá el aviso con tus notas; al actualizar, se descarga en segundo plano, se instala en silencio y el launcher se reinicia solo con los cambios.</li>
                </ol>
              </div>

              <div className="glass-card p-5">
                <h4 className="text-sm font-semibold text-white mb-2">Sincronizar mods con los usuarios</h4>
                <p className="text-xs text-dark-400 leading-relaxed">
                  Usa <span className="text-primary-300 font-medium">Publicar</span> en una instancia para exportar sus mods a un zip llamado <span className="font-mono">mods.zip</span>.
                  Súbelo al release de tag <span className="font-mono">mods-latest</span> de tu repo (créalo una vez; después reemplaza el archivo).
                  Todas las instancias nuevas ya vienen conectadas a ese pack oficial: al darle a Jugar se les instalan los nuevos, se les borran los eliminados y se actualizan los cambiados, sin pegar ningún enlace.
                  Importante: sube el zip ANTES de darle a Jugar en tu instancia de autor, o quita su fuente, para no revertir tus cambios sin publicar.
                </p>
              </div>
            </motion.div>
          )}

          {(tab === 'create' || tab === 'edit') && (
            <motion.div key="form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="max-w-2xl space-y-5">
              <h3 className="text-lg font-bold text-white">
                {editingInstance ? 'Editar Instancia' : 'Nueva Instancia'}
              </h3>

              <div className="glass-card p-5 space-y-4">
                <div className="grid grid-cols-[80px_1fr] gap-4">
                  <FormField label="Icono">
                    <div className="w-20 h-20 rounded-xl bg-dark-800/60 border border-dark-600/50 flex items-center justify-center overflow-hidden">
                      <InstanceIcon icon={form.icon} className="text-3xl" />
                    </div>
                    <motion.button whileTap={{ scale: 0.97 }} onClick={handlePickIcon}
                      className="btn-secondary w-full mt-2 text-[11px] flex items-center justify-center gap-1 py-2">
                      <ImagePlus size={13} /> Subir imagen
                    </motion.button>
                    <input type="text" value={form.icon.startsWith('data:image/') ? '' : form.icon}
                      onChange={(e) => setForm({ ...form, icon: e.target.value })}
                      className="input-field text-center text-xl mt-2" maxLength={2} placeholder="⛏️" />
                    {iconError && <p className="text-red-400 text-[10px] mt-1">{iconError}</p>}
                    {form.icon.startsWith('data:image/') && (
                      <p className="text-[10px] text-dark-500 mt-1">Imagen personalizada cargada. Escribe una letra para volver al emoji.</p>
                    )}
                  </FormField>
                  <FormField label="Nombre">
                    <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="input-field" placeholder="Mi Modpack" />
                  </FormField>
                </div>

                <FormField label="Descripción">
                  <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="input-field" placeholder="Descripción del modpack..." />
                </FormField>
              </div>

              <div className="glass-card p-5 space-y-4">
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Cpu size={14} className="text-primary-400" /> Motor del Juego
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <FormField label="Minecraft">
                    <select value={form.mcVersion} onChange={(e) => handleMcVersionChange(e.target.value)} className="input-field">
                      {MC_VERSIONS.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Mod Loader">
                    <select value={form.modLoader} onChange={(e) => handleLoaderChange(e.target.value as any)} className="input-field">
                      <option value="forge">Forge</option>
                      <option value="fabric">Fabric</option>
                      <option value="none">Vanilla</option>
                    </select>
                  </FormField>
                  <FormField label={`Versión ${(form.modLoader ?? 'none') === 'none' ? '' : (form.modLoader ?? 'none').charAt(0).toUpperCase() + (form.modLoader ?? 'none').slice(1)}`}>
                    {form.modLoader === 'none' ? (
                      <input type="text" value="" className="input-field font-mono text-sm" disabled placeholder="N/A" />
                    ) : (
                      <select value={form.modLoaderVersion}
                        onChange={(e) => setForm({ ...form, modLoaderVersion: e.target.value })}
                        className="input-field font-mono text-sm" disabled={loadingLoaders}>
                        <option value="">Auto (recomendada)</option>
                        {form.modLoaderVersion && !loaderOptions.some((o) => o.version === form.modLoaderVersion) && (
                          <option value={form.modLoaderVersion}>{form.modLoaderVersion} (actual)</option>
                        )}
                        {loaderOptions.map((o) => (
                          <option key={o.version} value={o.version}>
                            {o.version}{o.stable ? ' ★ estable' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </FormField>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <FormField label="Java (auto)">
                    <select value={form.javaVersion} onChange={(e) => setForm({ ...form, javaVersion: parseInt(e.target.value) })} className="input-field">
                      <option value={8}>Java 8 (MC 1.7-1.16)</option>
                      <option value={17}>Java 17 (MC 1.17-1.20.4)</option>
                      <option value={21}>Java 21 (MC 1.20.5+)</option>
                    </select>
                  </FormField>
                  <FormField label="RAM Mínimo">
                    <select value={form.ramMin} onChange={(e) => setForm({ ...form, ramMin: e.target.value })} className="input-field">
                      <option value="2G">2 GB</option>
                      <option value="3G">3 GB</option>
                      <option value="4G">4 GB</option>
                      <option value="6G">6 GB</option>
                      <option value="8G">8 GB</option>
                    </select>
                  </FormField>
                  <FormField label="RAM Máximo">
                    <select value={form.ramMax} onChange={(e) => setForm({ ...form, ramMax: e.target.value })} className="input-field">
                      <option value="2G">2 GB</option>
                      <option value="4G">4 GB</option>
                      <option value="6G">6 GB</option>
                      <option value="8G">8 GB</option>
                      <option value="12G">12 GB</option>
                      <option value="16G">16 GB</option>
                    </select>
                  </FormField>
                </div>
                <FormField label="Args JVM (opcional)">
                  <input type="text" value={form.jvmArgs} onChange={(e) => setForm({ ...form, jvmArgs: e.target.value })}
                    className="input-field font-mono text-sm" placeholder="-XX:+UseG1GC -XX:+ParallelRefProcEnabled" />
                </FormField>
              </div>

              <div className="glass-card p-5 space-y-4">
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Server size={14} className="text-primary-400" /> Servidor (opcional)
                </h4>
                <div className="grid grid-cols-[1fr_100px] gap-3">
                  <FormField label="Dirección"><input type="text" value={form.serverAddress} onChange={(e) => setForm({ ...form, serverAddress: e.target.value })} className="input-field" placeholder="play.servidor.com" /></FormField>
                  <FormField label="Puerto"><input type="number" value={form.serverPort} onChange={(e) => setForm({ ...form, serverPort: parseInt(e.target.value) || 25565 })} className="input-field" /></FormField>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <motion.button whileTap={{ scale: 0.98 }} onClick={() => { resetForm(); setTab('instances'); }} className="btn-secondary flex-1">Cancelar</motion.button>
                <motion.button whileTap={{ scale: 0.98 }} onClick={handleSave} disabled={!form.name}
                  className="btn-primary flex-1 flex items-center justify-center gap-2">
                  <Save size={16} />{editingInstance ? 'Guardar' : 'Crear'}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-dark-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
