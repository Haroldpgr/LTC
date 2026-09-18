import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Download,
  ArrowLeft,
  Loader2,
  Package,
  ChevronDown,
  Check,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '@/stores/instanceStore';

interface ModrinthMod {
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  follows: number;
  icon_url: string | null;
  project_id: string;
  versions: string[];
  categories: string[];
}

interface ModrinthVersion {
  id: string;
  name: string;
  version_number: string;
  files: Array<{
    url: string;
    filename: string;
    size: number;
    primary: boolean;
  }>;
  game_versions: string[];
  loaders: string[];
  date_published: string;
  downloads: number;
}

export function ModBrowser() {
  const { selectedInstance, selectInstance, loadInstances } = useInstanceStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ModrinthMod[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedMod, setSelectedMod] = useState<ModrinthMod | null>(null);
  const [modVersions, setModVersions] = useState<ModrinthVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());

  const instance = selectedInstance;

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !instance) return;
    setSearching(true);
    try {
      const response = await invoke<{ hits: ModrinthMod[] }>('search_mods', {
        query: query.trim(),
        mcVersion: instance.mcVersion,
        loader: instance.modLoader,
      });
      setResults(response.hits);
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
    }
    setSearching(false);
  }, [query, instance]);

  const handleSelectMod = async (mod: ModrinthMod) => {
    if (!instance) return;
    setSelectedMod(mod);
    setLoadingVersions(true);
    try {
      const versions = await invoke<ModrinthVersion[]>('get_mod_versions', {
        projectId: mod.project_id,
        mcVersion: instance.mcVersion,
        loader: instance.modLoader,
      });
      setModVersions(versions);
    } catch (error) {
      console.error('Failed to get versions:', error);
      setModVersions([]);
    }
    setLoadingVersions(false);
  };

  const handleInstallMod = async (version: ModrinthVersion) => {
    if (!instance) return;
    const file = version.files.find((f) => f.primary) || version.files[0];
    if (!file) return;

    setInstalling(version.id);
    try {
      await invoke('install_mod_from_url', {
        instanceId: instance.id,
        downloadUrl: file.url,
        filename: file.filename,
        modName: selectedMod?.title || file.filename.replace('.jar', ''),
        versionNumber: version.version_number,
        iconUrl: selectedMod?.icon_url || null,
      });
      setInstalled((prev) => new Set([...prev, version.id]));
      await loadInstances();
    } catch (error) {
      console.error('Failed to install mod:', error);
    }
    setInstalling(null);
  };

  const formatDownloads = (n: number): string => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="h-full flex flex-col"
    >
      {/* Header */}
      <header className="px-6 py-4 border-b border-white/5 flex items-center gap-4">
        <button onClick={() => selectInstance(null)} className="btn-ghost p-2">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h2 className="font-bold text-white flex items-center gap-2">
            <Package size={18} className="text-primary-400" />
            Tienda de Mods
          </h2>
          <p className="text-xs text-dark-400">
            Busca e instala mods para <span className="text-primary-300">{instance?.name}</span>
            {' '}· MC {instance?.mcVersion} · {instance?.modLoader}
          </p>
        </div>
      </header>

      {/* Search bar */}
      <div className="px-6 py-3 border-b border-white/5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Buscar mods en Modrinth..."
              className="input-field pl-10"
              autoFocus
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            className="btn-primary flex items-center gap-2"
          >
            {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Buscar
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Mod list */}
        <div className={`overflow-y-auto transition-all duration-300 ${selectedMod ? 'w-1/2 border-r border-white/5' : 'w-full'}`}>
          {results.length === 0 && !searching ? (
            <div className="h-full flex items-center justify-center p-6">
              <div className="text-center">
                <Search size={40} className="text-dark-600 mx-auto mb-3" />
                <p className="text-dark-400 text-sm">Busca mods para instalar</p>
                <p className="text-dark-500 text-xs mt-1">
                  Resultados de Modrinth para MC {instance?.mcVersion}
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {results.map((mod) => (
                <motion.div
                  key={mod.project_id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => handleSelectMod(mod)}
                  className={`glass-card-hover p-4 cursor-pointer ${
                    selectedMod?.project_id === mod.project_id ? 'ring-1 ring-primary-500/50 bg-white/10' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {mod.icon_url ? (
                      <img
                        src={mod.icon_url}
                        alt={mod.title}
                        className="w-11 h-11 rounded-lg border border-white/10"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-lg bg-dark-700 flex items-center justify-center border border-white/10">
                        <Package size={18} className="text-dark-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-white text-sm truncate">{mod.title}</h4>
                      <p className="text-dark-400 text-xs mt-0.5 line-clamp-2">{mod.description}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[11px] text-dark-500">por {mod.author}</span>
                        <span className="text-[11px] text-dark-500 flex items-center gap-1">
                          <Download size={10} />
                          {formatDownloads(mod.downloads)}
                        </span>
                      </div>
                    </div>
                    <ChevronDown size={16} className="text-dark-500 -rotate-90 shrink-0 mt-1" />
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Version panel */}
        <AnimatePresence>
          {selectedMod && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: '50%', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="overflow-y-auto"
            >
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {selectedMod.icon_url && (
                      <img
                        src={selectedMod.icon_url}
                        alt={selectedMod.title}
                        className="w-8 h-8 rounded-lg"
                      />
                    )}
                    <div>
                      <h3 className="font-bold text-white text-sm">{selectedMod.title}</h3>
                      <p className="text-xs text-dark-400">{selectedMod.author}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedMod(null)}
                    className="btn-ghost text-xs"
                  >
                    Cerrar
                  </button>
                </div>

                <p className="text-xs text-dark-400 mb-4 line-clamp-3">{selectedMod.description}</p>

                {selectedMod.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-4">
                    {selectedMod.categories.map((cat) => (
                      <span
                        key={cat}
                        className="px-2 py-0.5 bg-primary-900/30 text-primary-300 rounded text-[10px] capitalize"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                )}

                <h4 className="text-xs font-semibold text-dark-300 mb-2">Versiones disponibles</h4>

                {loadingVersions ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={20} className="animate-spin text-primary-400" />
                  </div>
                ) : modVersions.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-dark-500 text-xs">
                      No hay versiones para MC {instance?.mcVersion} + {instance?.modLoader}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {modVersions.slice(0, 10).map((version) => {
                      const file = version.files.find((f) => f.primary) || version.files[0];
                      const isInstalled = installed.has(version.id);
                      const isInstalling = installing === version.id;

                      return (
                        <div
                          key={version.id}
                          className="flex items-center gap-3 px-3 py-2.5 bg-dark-800/50 rounded-lg border border-dark-700"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                              {version.version_number}
                            </p>
                            <p className="text-[11px] text-dark-500">
                              {file?.filename} · {(file?.size ?? 0 / 1024).toFixed(0)}KB
                              · {formatDownloads(version.downloads)} descargas
                            </p>
                          </div>
                          <button
                            onClick={() => handleInstallMod(version)}
                            disabled={isInstalling || isInstalled}
                            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all active:scale-95 ${
                              isInstalled
                                ? 'bg-accent-600/20 text-accent-400 border border-accent-500/30'
                                : 'bg-primary-600 hover:bg-primary-500 text-white'
                            } disabled:opacity-50`}
                          >
                            {isInstalling ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : isInstalled ? (
                              <>
                                <Check size={12} /> Instalado
                              </>
                            ) : (
                              <>
                                <Download size={12} /> Instalar
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
