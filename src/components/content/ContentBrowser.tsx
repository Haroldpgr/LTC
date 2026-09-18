import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Download, Loader2, Package, Layers, Image, Sun,
  Check, AlertTriangle, ChevronLeft, ChevronRight, X, FolderOpen, HardDrive,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '@/stores/instanceStore';

interface MR { slug: string; title: string; description: string; author: string; downloads: number; icon_url: string | null; project_id: string; categories: string[]; }
interface MV { id: string; version_number: string; files: Array<{ url: string; filename: string; size: number; primary: boolean }>; game_versions: string[]; loaders: string[]; downloads: number; date_published: string; }
interface CF { id: number; name: string; summary: string; downloadCount: number; logo?: { thumbnailUrl: string }; authors?: Array<{ name: string }>; categories?: Array<{ name: string }>; }

const CAT: Record<string, { icon: typeof Package; label: string; mrType: string; cfClass: number; needsVersion: boolean }> = {
  mods:          { icon: Package, label: 'Mods',          mrType: 'mod',          cfClass: 6,    needsVersion: true },
  modpacks:      { icon: Layers,  label: 'Modpacks',      mrType: 'modpack',      cfClass: 4471, needsVersion: true },
  resourcepacks: { icon: Image,   label: 'Resource Packs', mrType: 'resourcepack', cfClass: 12,   needsVersion: false },
  shaders:       { icon: Sun,     label: 'Shaders',        mrType: 'shader',       cfClass: 6552, needsVersion: false },
};

const PER = 20;
const MR_API = 'https://api.modrinth.com/v2';
const CF_API = 'https://api.curseforge.com/v1';
const CF_KEY = '$2a$10$8qrneNohy/pV0jJKZVbUuu.kXuDwlRmfhnf4o.7VGEN/bEjXTOPWC';

type Item = { pid: string; title: string; desc: string; author: string; dl: number; icon: string | null; cats: string[]; src: 'modrinth' | 'curseforge' };

export function ContentBrowser() {
  const { contentCategory, contentSource, setContentSource, instances, loadInstances } = useInstanceStore();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Install modal state
  const [installTarget, setInstallTarget] = useState<Item | null>(null);
  const [installMode, setInstallMode] = useState<'instance' | 'free'>('instance');
  const [modalStep, setModalStep] = useState<'target' | 'version'>('target');
  const [versions, setVersions] = useState<MV[]>([]);
  const [loadingV, setLoadingV] = useState(false);
  const [selVersion, setSelVersion] = useState<MV | null>(null);
  const [selInstance, setSelInstance] = useState('');
  const [freeMcVer, setFreeMcVer] = useState('1.20.1');
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState<Set<string>>(new Set());

  const MC_VERSIONS = [
    '1.21.4','1.21.1','1.20.6','1.20.4','1.20.2','1.20.1','1.20',
    '1.19.4','1.19.3','1.19.2','1.19.1','1.19',
    '1.18.2','1.18.1','1.18','1.17.1','1.16.5','1.12.2','1.8.9','1.7.10',
  ];

  const abortRef = useRef<AbortController | null>(null);
  const cfg = CAT[contentCategory] ?? CAT.mods!;
  const Icon = cfg.icon;
  const pages = Math.max(1, Math.ceil(total / PER));
  const inst = instances[0];
  const mcVer = inst?.mcVersion || '1.20.1';
  const loader = inst?.modLoader || 'forge';

  // Fetch function
  const doFetch = async (searchQ: string, pg: number) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true); setErr('');

    const offset = (pg - 1) * PER;
    try {
      let result: Item[] = [];
      let tot = 0;

      if (contentSource === 'modrinth') {
        let facets: string;
        if (cfg.needsVersion) {
          facets = loader !== 'none' && cfg.mrType === 'mod'
            ? `[["versions:${mcVer}"],["project_type:${cfg.mrType}"],["categories:${loader}"]]`
            : `[["versions:${mcVer}"],["project_type:${cfg.mrType}"]]`;
        } else {
          facets = `[["project_type:${cfg.mrType}"]]`;
        }
        const params = new URLSearchParams({
          facets, limit: String(PER), offset: String(offset),
          index: searchQ ? 'relevance' : 'downloads',
        });
        if (searchQ) params.set('query', searchQ);
        const url = `${MR_API}/search?${params}`;
        console.log('[LTC] MR:', url);

        const res = await window.fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`Modrinth HTTP ${res.status}`);
        const data = await res.json() as { hits: MR[]; total_hits: number };
        result = (data.hits || []).map((h) => ({
          pid: h.project_id, title: h.title, desc: h.description,
          author: h.author, dl: h.downloads, icon: h.icon_url,
          cats: h.categories || [], src: 'modrinth' as const,
        }));
        tot = data.total_hits || 0;
      } else {
        const params = new URLSearchParams({
          gameId: '432', classId: String(cfg.cfClass),
          pageSize: String(PER), index: String(offset),
          sortField: '2', sortOrder: 'desc',
        });
        if (cfg.needsVersion) params.set('gameVersion', mcVer);
        if (searchQ) params.set('searchFilter', searchQ);
        const url = `${CF_API}/mods/search?${params}`;
        console.log('[LTC] CF:', url);

        const res = await window.fetch(url, { signal: ctrl.signal, headers: { 'x-api-key': CF_KEY, 'Accept': 'application/json' } });
        if (!res.ok) { const t = await res.text(); throw new Error(`CurseForge ${res.status}: ${t.slice(0, 150)}`); }
        const data = await res.json() as { data: CF[]; pagination: { index: number; pageSize: number; resultCount: number; totalCount: number } };
        console.log('[LTC] CF pagination:', JSON.stringify(data.pagination));
        result = (data.data || []).map((d) => ({
          pid: String(d.id), title: d.name, desc: d.summary || '',
          author: d.authors?.[0]?.name || 'Unknown', dl: d.downloadCount || 0,
          icon: d.logo?.thumbnailUrl || null,
          cats: (d.categories || []).map((c) => c.name),
          src: 'curseforge' as const,
        }));
        tot = data.pagination?.totalCount ?? data.pagination?.resultCount ?? 0;
      }

      if (!ctrl.signal.aborted) { setItems(result); setTotal(tot); }
    } catch (e: any) {
      if (e.name !== 'AbortError') { console.error('[LTC]', e); setErr(String(e)); setItems([]); }
    }
    if (!ctrl.signal.aborted) setLoading(false);
  };

  // Auto-load on category/source/version change
  useEffect(() => { setQ(''); setPage(1); setItems([]); setTotal(0); doFetch('', 1); }, [contentCategory, contentSource, mcVer, loader]);

  const handleSearch = () => { setPage(1); doFetch(q.trim(), 1); };
  const handlePage = (p: number) => { setPage(p); doFetch(q.trim(), p); };

  // Open install modal - start at target selection
  const openInstall = (item: Item) => {
    setInstallTarget(item);
    setVersions([]); setSelVersion(null);
    setInstallMode(instances.length > 0 ? 'instance' : 'free');
    setSelInstance('');
    setFreeMcVer(mcVer);
    setModalStep('target');
  };

  // After selecting target, fetch versions
  const confirmTarget = () => {
    setModalStep('version');
  };

  // Fetch versions when entering version step
  useEffect(() => {
    if (!installTarget || modalStep !== 'version') return;
    let cancelled = false;

    const fetchVersions = async () => {
      setLoadingV(true); setVersions([]); setSelVersion(null);

      const targetMc = installMode === 'instance'
        ? (instances.find((i) => i.id === selInstance)?.mcVersion || mcVer)
        : freeMcVer;
      const targetLoader = installMode === 'instance'
        ? (instances.find((i) => i.id === selInstance)?.modLoader || loader)
        : 'none';
      const filterByVer = cfg.needsVersion;

      try {
        if (installTarget.src === 'modrinth') {
          const params = new URLSearchParams();
          if (filterByVer) params.set('game_versions', JSON.stringify([targetMc]));
          if (filterByVer && targetLoader !== 'none' && cfg.mrType === 'mod') {
            params.set('loaders', JSON.stringify([targetLoader]));
          }
          const url = `${MR_API}/project/${installTarget.pid}/version?${params}`;
          console.log('[LTC] Modal MR versions:', url);
          const res = await window.fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json() as MV[];
          if (!cancelled) { setVersions(data || []); if (data?.length) setSelVersion(data[0] ?? null); }
        } else {
          const params = new URLSearchParams({ pageSize: '30' });
          if (filterByVer) params.set('gameVersion', targetMc);
          const url = `${CF_API}/mods/${installTarget.pid}/files?${params}`;
          console.log('[LTC] Modal CF versions:', url);
          const res = await window.fetch(url, { headers: { 'x-api-key': CF_KEY } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json() as { data: any[] };
          const mapped: MV[] = (data.data || []).map((v: any) => ({
            id: String(v.id), version_number: v.displayName || v.fileName || 'Unknown',
            files: [{ url: v.downloadUrl, filename: v.fileName, size: v.fileLength || 0, primary: true }],
            game_versions: v.gameVersions || [], loaders: [], downloads: v.downloadCount || 0,
            date_published: v.fileDate || '',
          }));
          if (!cancelled) { setVersions(mapped); if (mapped.length) setSelVersion(mapped[0] ?? null); }
        }
      } catch (e) { console.error('[LTC] versions:', e); }
      if (!cancelled) setLoadingV(false);
    };

    fetchVersions();
    return () => { cancelled = true; };
  }, [installTarget, modalStep, selInstance, freeMcVer]);

  // Install to instance
  const installToInstance = async () => {
    if (!selVersion || !selInstance || !installTarget) return;
    const file = selVersion.files.find((f) => f.primary) || selVersion.files[0];
    if (!file?.url) return;
    setInstalling(true);
    try {
      await invoke('install_mod_from_url', {
        instanceId: selInstance, downloadUrl: file.url, filename: file.filename,
        modName: installTarget.title, versionNumber: selVersion.version_number,
        iconUrl: installTarget.icon || null,
      });
      setInstalled((prev) => new Set([...prev, installTarget.pid]));
      await loadInstances();
      setInstallTarget(null);
    } catch (e) { console.error('[LTC] install:', e); }
    setInstalling(false);
  };

  // Download to PC (Downloads folder via Rust)
  const downloadToLocal = async () => {
    if (!selVersion || !installTarget) return;
    const file = selVersion.files.find((f) => f.primary) || selVersion.files[0];
    if (!file?.url) return;
    setInstalling(true);
    try {
      const path = await invoke<string>('download_file_to_disk', {
        downloadUrl: file.url,
        filename: file.filename,
      });
      console.log('[LTC] Downloaded to:', path);
      setInstallTarget(null);
    } catch (e) { console.error('[LTC] download:', e); }
    setInstalling(false);
  };

  const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon size={18} className="text-primary-400" />
            <h2 className="font-bold text-white">{q.trim() ? cfg.label : `${cfg.label} Populares`}</h2>
            {total > 0 && <span className="text-[11px] text-dark-500">· {fmt(total)} {q.trim() ? 'resultados' : 'disponibles'}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-dark-800 rounded-lg p-0.5">
              <button onClick={() => { setContentSource('modrinth'); setQ(''); setPage(1); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${contentSource === 'modrinth' ? 'bg-[#1bd96a]/20 text-[#1bd96a]' : 'text-dark-400 hover:text-dark-200'}`}>Modrinth</button>
              <button onClick={() => { setContentSource('curseforge'); setQ(''); setPage(1); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${contentSource === 'curseforge' ? 'bg-[#f16436]/20 text-[#f16436]' : 'text-dark-400 hover:text-dark-200'}`}>CurseForge</button>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
              placeholder={`Buscar ${cfg.label.toLowerCase()}...`} className="input-field pl-9 text-sm" />
          </div>
          <motion.button whileTap={{ scale: 0.95 }} onClick={handleSearch} disabled={loading}
            className="btn-primary text-sm flex items-center gap-2 px-5">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Buscar
          </motion.button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && items.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 size={28} className="animate-spin text-primary-400" />
          </div>
        ) : err ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center"><AlertTriangle size={32} className="text-red-400/50 mx-auto mb-3" />
              <p className="text-red-400 text-sm mb-1">Error</p><p className="text-dark-500 text-xs max-w-sm break-all">{err}</p></div>
          </div>
        ) : items.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center"><Search size={32} className="text-dark-700 mx-auto mb-3" /><p className="text-dark-500 text-sm">Sin resultados</p></div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {items.map((item, i) => (
                <motion.div key={item.pid} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.3) }}
                  className="glass-card-hover p-4 group">
                  <div className="flex items-start gap-3 mb-3">
                    {item.icon ? (
                      <img src={item.icon} alt={item.title} className="w-12 h-12 rounded-lg border border-white/10 object-cover shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-dark-700 flex items-center justify-center border border-white/10 shrink-0">
                        <Icon size={20} className="text-dark-400" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-white text-sm truncate">{item.title}</h4>
                      <p className="text-[11px] text-dark-400 mt-0.5">{item.author}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-dark-500 flex items-center gap-0.5"><Download size={9} />{fmt(item.dl)}</span>
                        {item.cats[0] && <span className="text-[10px] text-primary-400/70 bg-primary-500/10 px-1.5 py-0.5 rounded">{item.cats[0]}</span>}
                      </div>
                    </div>
                  </div>
                  <p className="text-dark-400 text-[11px] line-clamp-2 mb-3">{item.desc}</p>
                  <motion.button whileTap={{ scale: 0.97 }} onClick={() => openInstall(item)}
                    disabled={installed.has(item.pid)}
                    className={`w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                      installed.has(item.pid)
                        ? 'bg-accent-600/15 text-accent-400 border border-accent-500/20'
                        : 'bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 text-white shadow-lg shadow-primary-600/20'
                    }`}>
                    {installed.has(item.pid) ? <><Check size={13} /> Instalado</> : <><Download size={13} /> Descargar</>}
                  </motion.button>
                </motion.div>
              ))}
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-center gap-1.5 mt-6 pb-4">
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => handlePage(page - 1)} disabled={page <= 1 || loading}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-dark-800 text-dark-400 hover:bg-dark-700 disabled:opacity-30 transition-all">
                  <ChevronLeft size={14} />
                </motion.button>
                {Array.from({ length: Math.min(7, pages) }, (_, i) => {
                  let pn: number;
                  if (pages <= 7) pn = i + 1;
                  else if (page <= 4) pn = i + 1;
                  else if (page >= pages - 3) pn = pages - 6 + i;
                  else pn = page - 3 + i;
                  return (
                    <motion.button key={pn} whileTap={{ scale: 0.9 }} onClick={() => handlePage(pn)} disabled={loading}
                      className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${pn === page ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/20' : 'bg-dark-800 text-dark-400 hover:bg-dark-700 hover:text-white'}`}>
                      {pn}
                    </motion.button>
                  );
                })}
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => handlePage(page + 1)} disabled={page >= pages || loading}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-dark-800 text-dark-400 hover:bg-dark-700 disabled:opacity-30 transition-all">
                  <ChevronRight size={14} />
                </motion.button>
                <span className="text-[11px] text-dark-500 ml-2">{page}/{pages}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Install Modal */}
      <AnimatePresence>
        {installTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setInstallTarget(null)}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card p-6 w-full max-w-lg mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>

              {/* Header */}
              <div className="flex items-center gap-3 mb-4">
                {installTarget.icon && <img src={installTarget.icon} alt="" className="w-11 h-11 rounded-lg object-cover border border-white/10" />}
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-white truncate text-sm">{installTarget.title}</h3>
                  <p className="text-[11px] text-dark-400">{installTarget.author} · {installTarget.src === 'modrinth' ? 'Modrinth' : 'CurseForge'}</p>
                </div>
                <button onClick={() => setInstallTarget(null)} className="btn-ghost p-1.5"><X size={16} /></button>
              </div>

              {/* STEP 1: Choose target */}
              {modalStep === 'target' && (
                <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex-1 flex flex-col min-h-0">
                  {/* Mode tabs */}
                  <div className="flex items-center bg-dark-800 rounded-lg p-0.5 mb-4">
                    <button onClick={() => { setInstallMode('instance'); setSelInstance(''); }}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                        installMode === 'instance' ? 'bg-primary-600/20 text-primary-300' : 'text-dark-400 hover:text-dark-200'
                      }`}>
                      <HardDrive size={13} /> Instancia
                    </button>
                    <button onClick={() => setInstallMode('free')}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                        installMode === 'free' ? 'bg-primary-600/20 text-primary-300' : 'text-dark-400 hover:text-dark-200'
                      }`}>
                      <FolderOpen size={13} /> Libre (Mi PC)
                    </button>
                  </div>

                  {/* Instance mode */}
                  {installMode === 'instance' && (
                    <div className="flex-1 overflow-y-auto min-h-0">
                      {instances.length === 0 ? (
                        <div className="text-center py-8">
                          <AlertTriangle size={24} className="text-dark-600 mx-auto mb-2" />
                          <p className="text-dark-500 text-xs">No hay instancias creadas</p>
                          <p className="text-dark-600 text-[10px] mt-1">Crea una desde el panel admin</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[11px] font-medium text-dark-400 mb-1">Elige la instancia donde instalar</p>
                          {instances.map((inst) => (
                            <motion.button key={inst.id} whileTap={{ scale: 0.98 }}
                              onClick={() => setSelInstance(inst.id)}
                              className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                                selInstance === inst.id
                                  ? 'bg-primary-600/15 border-primary-500/30 ring-1 ring-primary-500/20'
                                  : 'bg-dark-800/50 border-dark-700/50 hover:bg-dark-700/50 hover:border-dark-600'
                              }`}>
                              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-600/30 to-accent-600/30 flex items-center justify-center border border-white/5 shrink-0">
                                <span className="text-lg">{inst.icon || '⛏️'}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-semibold truncate ${selInstance === inst.id ? 'text-white' : 'text-dark-200'}`}>{inst.name}</p>
                                <p className="text-[11px] text-dark-500">MC {inst.mcVersion} · {inst.modLoader} · {inst.mods.length} mods</p>
                              </div>
                              <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${selInstance === inst.id ? 'border-primary-400' : 'border-dark-600'}`}>
                                {selInstance === inst.id && <div className="w-2 h-2 rounded-full bg-primary-400" />}
                              </div>
                            </motion.button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Free mode */}
                  {installMode === 'free' && (
                    <div className="flex-1">
                      <p className="text-[11px] font-medium text-dark-400 mb-3">Se descargará a tu carpeta de Descargas</p>
                      {cfg.needsVersion && (
                        <div className="mb-2">
                          <label className="text-[11px] font-medium text-dark-400 mb-1.5 block">Filtrar por versión de Minecraft</label>
                          <select value={freeMcVer} onChange={(e) => setFreeMcVer(e.target.value)} className="input-field text-xs py-2">
                            {MC_VERSIONS.map((v) => <option key={v} value={v}>Minecraft {v}</option>)}
                          </select>
                          <p className="text-[10px] text-dark-500 mt-1">Solo versiones compatibles con MC {freeMcVer}</p>
                        </div>
                      )}
                      {!cfg.needsVersion && (
                        <p className="text-[10px] text-dark-500">No requiere versión específica de Minecraft</p>
                      )}
                    </div>
                  )}

                  {/* Confirm button */}
                  <div className="flex gap-2 mt-4 pt-3 border-t border-white/5">
                    <motion.button whileTap={{ scale: 0.97 }} onClick={() => setInstallTarget(null)} className="btn-secondary flex-1">Cancelar</motion.button>
                    <motion.button whileTap={{ scale: 0.97 }} onClick={confirmTarget}
                      disabled={installMode === 'instance' && !selInstance}
                      className="btn-primary flex-1 flex items-center justify-center gap-2">
                      Continuar <ChevronRight size={14} />
                    </motion.button>
                  </div>
                </motion.div>
              )}

              {/* STEP 2: Choose version */}
              {modalStep === 'version' && (
                <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="flex-1 flex flex-col min-h-0">
                  {/* Context */}
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <button onClick={() => setModalStep('target')} className="btn-ghost p-1"><ChevronLeft size={14} /></button>
                    <div className="flex-1">
                      <p className="text-xs text-dark-300 font-medium">
                        {installMode === 'instance'
                          ? `→ ${instances.find((i) => i.id === selInstance)?.name}`
                          : '→ Descargar a Mi PC'}
                      </p>
                      <p className="text-[10px] text-dark-500">
                        {installMode === 'instance'
                          ? `MC ${instances.find((i) => i.id === selInstance)?.mcVersion} · ${instances.find((i) => i.id === selInstance)?.modLoader}`
                          : cfg.needsVersion ? `Filtrado: MC ${freeMcVer}` : 'Sin filtro de versión'}
                      </p>
                    </div>
                  </div>

                  {/* Versions list */}
                  <div className="flex-1 overflow-y-auto min-h-0 mb-4">
                    {loadingV ? (
                      <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin text-primary-400" /></div>
                    ) : versions.length === 0 ? (
                      <div className="text-center py-10">
                        <AlertTriangle size={24} className="text-dark-600 mx-auto mb-2" />
                        <p className="text-dark-500 text-xs">Sin versiones disponibles</p>
                        <p className="text-dark-600 text-[10px] mt-1">
                          {installMode === 'instance'
                            ? `No hay versiones para MC ${instances.find((i) => i.id === selInstance)?.mcVersion}`
                            : `No hay versiones para MC ${freeMcVer}`}
                        </p>
                        <button onClick={() => setModalStep('target')} className="btn-ghost text-xs mt-2">← Cambiar destino</button>
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
                        {versions.slice(0, 40).map((v) => {
                          const file = v.files.find((f) => f.primary) || v.files[0];
                          const sel = selVersion?.id === v.id;
                          return (
                            <motion.button key={v.id} whileTap={{ scale: 0.98 }} onClick={() => setSelVersion(v)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                                sel ? 'bg-primary-600/20 border border-primary-500/30 ring-1 ring-primary-500/20' : 'bg-dark-800/50 border border-dark-700/50 hover:bg-dark-700/50'
                              }`}>
                              <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${sel ? 'border-primary-400' : 'border-dark-600'}`}>
                                {sel && <div className="w-2 h-2 rounded-full bg-primary-400" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-xs font-medium truncate ${sel ? 'text-white' : 'text-dark-200'}`}>{v.version_number}</p>
                                <p className="text-[10px] text-dark-500 truncate">{file?.filename} · {((file?.size ?? 0) / 1024).toFixed(0)}KB</p>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="text-[10px] text-dark-500">{fmt(v.downloads)}</span>
                                {v.game_versions.length > 0 && (
                                  <p className="text-[9px] text-dark-600 truncate max-w-[80px]">{v.game_versions.slice(0, 2).join(', ')}</p>
                                )}
                              </div>
                            </motion.button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Install/Download button */}
                  <div className="pt-3 border-t border-white/5">
                    {installing && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mb-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Loader2 size={12} className="animate-spin text-primary-400" />
                          <p className="text-[11px] text-primary-300">
                            {installMode === 'instance' ? 'Instalando en instancia...' : 'Descargando a Descargas...'}
                          </p>
                        </div>
                        <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
                          <motion.div className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full"
                            initial={{ width: '0%' }}
                            animate={{ width: '100%' }}
                            transition={{ duration: 3, ease: 'easeInOut' }}
                          />
                        </div>
                      </motion.div>
                    )}
                    <div className="flex gap-2">
                      <motion.button whileTap={{ scale: 0.97 }} onClick={() => setInstallTarget(null)} className="btn-secondary flex-1" disabled={installing}>Cancelar</motion.button>
                      <motion.button whileTap={{ scale: 0.97 }}
                        onClick={installMode === 'instance' ? installToInstance : downloadToLocal}
                        disabled={!selVersion || installing}
                        className="btn-primary flex-1 flex items-center justify-center gap-2">
                        {installing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                        {installMode === 'instance' ? 'Instalar en Instancia' : 'Descargar a Mi PC'}
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
