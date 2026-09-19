import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ModpackInstance, LauncherState, DownloadProgress } from '@/types';

interface InstanceStore {
  instances: ModpackInstance[];
  selectedInstance: ModpackInstance | null;
  launcherState: LauncherState;
  isAdmin: boolean;
  activeTab: 'instances' | 'content' | 'skins';
  contentCategory: 'mods' | 'modpacks' | 'resourcepacks' | 'shaders';
  contentSource: 'modrinth' | 'curseforge';
  runningInstanceId: string | null;
  savedAccounts: SavedAccount[];
  loadInstances: () => Promise<void>;
  selectInstance: (instance: ModpackInstance | null) => void;
  play: (instanceId: string) => Promise<void>;
  installInstance: (instanceId: string) => Promise<void>;
  adminLogin: (password: string) => Promise<boolean>;
  createInstance: (instance: Omit<ModpackInstance, 'id'>) => Promise<void>;
  updateInstance: (id: string, updates: Partial<ModpackInstance>) => Promise<void>;
  deleteInstance: (id: string) => Promise<void>;
  addModToLocal: (instanceId: string, filePath: string) => Promise<void>;
  removeMod: (instanceId: string, modId: string) => Promise<void>;
  toggleMod: (instanceId: string, modId: string) => Promise<void>;
  resolveModIcons: (instanceId: string) => Promise<number>;
  setDownloadProgress: (progress: DownloadProgress | null) => void;
  adminLogout: () => void;
  setActiveTab: (tab: 'instances' | 'content' | 'skins') => void;
  setContentCategory: (cat: 'mods' | 'modpacks' | 'resourcepacks' | 'shaders') => void;
  setContentSource: (src: 'modrinth' | 'curseforge') => void;
  addSavedAccount: (account: SavedAccount) => void;
  removeSavedAccount: (username: string) => void;
  setAccountSkin: (username: string, skinDataUrl: string | null) => void;
  setModsSourceFolder: (instanceId: string, folderPath: string) => Promise<void>;
  setModsSourceArchive: (instanceId: string, archivePath: string) => Promise<void>;
  setModsSourceUrl: (instanceId: string, url: string) => Promise<void>;
  clearModsSource: (instanceId: string) => Promise<void>;
  syncModsSource: (instanceId: string) => Promise<boolean>;
  syncOfficialSources: () => Promise<number>;
  publishModsPack: (instanceId: string) => Promise<string>;
  publishCatalog: () => Promise<string>;
  syncCatalog: () => Promise<number>;
  onRealtimeCatalog: () => Promise<void>;
  initRealtime: () => void;
}

export interface SavedAccount {
  username: string;
  type: 'microsoft' | 'offline';
  skinUrl?: string;
  lastUsed: string;
}

let progressListenerRegistered = false;

export const useInstanceStore = create<InstanceStore>((set, get) => {
  if (!progressListenerRegistered) {
    progressListenerRegistered = true;
    listen<DownloadProgress>('download-progress', (event) => {
      set((state) => ({
        launcherState: { ...state.launcherState, downloadProgress: event.payload },
      }));
    }).catch(() => {});
    listen<{ message: string }>('install-status', (event) => {
      set((state) => ({
        launcherState: { ...state.launcherState, statusMessage: event.payload.message },
      }));
    }).catch(() => {});
    listen<{ instanceId: string; code: number; earlyExit: boolean }>('game-exited', (event) => {
      const { instanceId, code, earlyExit } = event.payload;
      set((state) => ({
        runningInstanceId: state.runningInstanceId === instanceId ? null : state.runningInstanceId,
        launcherState: {
          ...state.launcherState,
          isLaunching: false,
          statusMessage: earlyExit ? '' : 'Minecraft cerrado',
          error: earlyExit
            ? `Minecraft se cerró al iniciar (código ${code}). Causas comunes: Java incorrecto, mods incompatibles o archivos dañados. Prueba reinstalar la instancia.`
            : state.launcherState.error,
        },
      }));
    }).catch(() => {});
  }

  invoke<SavedAccount[]>('get_saved_accounts')
    .then((accounts) => set({ savedAccounts: accounts }))
    .catch(() => {});

  return {
    instances: [],
    selectedInstance: null,
    launcherState: { isLaunching: false, isInstalling: false, downloadProgress: null, statusMessage: '', error: null },
    isAdmin: false,
    activeTab: 'instances',
    contentCategory: 'mods',
    contentSource: 'modrinth',
    runningInstanceId: null,
    savedAccounts: [],

    loadInstances: async () => {
      try {
        const instances = await invoke<ModpackInstance[]>('get_instances');
        set((state) => ({
          instances,
          selectedInstance: state.selectedInstance
            ? instances.find((i) => i.id === state.selectedInstance!.id) ?? state.selectedInstance
            : null,
        }));
      } catch (error) {
        console.error('Failed to load instances:', error);
      }
    },

    selectInstance: (instance) => set({ selectedInstance: instance }),

    play: async (instanceId: string) => {
      const { runningInstanceId } = get();
      if (runningInstanceId && runningInstanceId !== instanceId) {
        set((state) => ({
          launcherState: { ...state.launcherState, error: 'Ya hay una instancia ejecutándose. Ciérrala primero.' },
        }));
        return;
      }
      set((state) => ({
        launcherState: { ...state.launcherState, isLaunching: true, statusMessage: 'Sincronizando mods...', error: null },
        runningInstanceId: instanceId,
      }));
      try {
        await invoke('sync_and_launch', { instanceId });
        set((state) => ({
          launcherState: { ...state.launcherState, isLaunching: false, statusMessage: 'Minecraft ejecutándose' },
        }));
      } catch (error) {
        set((state) => ({
          launcherState: { ...state.launcherState, isLaunching: false, error: String(error), runningInstanceId: null },
        }));
      }
    },

    installInstance: async (instanceId: string) => {
      set((state) => ({
        launcherState: { ...state.launcherState, isInstalling: true, statusMessage: 'Instalando...', error: null },
      }));
      try {
        await invoke('install_instance', { instanceId });
        await get().loadInstances();
        set((state) => ({
          launcherState: { ...state.launcherState, isInstalling: false, statusMessage: '¡Instalación completada! Ya puedes jugar.', downloadProgress: null, error: null },
        }));
      } catch (error) {
        set((state) => ({
          launcherState: { ...state.launcherState, isInstalling: false, error: String(error) },
        }));
      }
    },

    adminLogin: async (password: string) => {
      try {
        const result = await invoke<boolean>('admin_login', { password });
        set({ isAdmin: result });
        return result;
      } catch { return false; }
    },

    adminLogout: () => set({ isAdmin: false }),

    createInstance: async (instance) => {
      await invoke('create_instance', { instance });
      await get().loadInstances();
    },

    updateInstance: async (id, updates) => {
      await invoke('update_instance', { id, updates });
      await get().loadInstances();
    },

    deleteInstance: async (id) => {
      await invoke('delete_instance', { id });
      await get().loadInstances();
    },

    addModToLocal: async (instanceId, filePath) => {
      await invoke('add_mod_local', { instanceId, filePath });
      await get().loadInstances();
    },

    removeMod: async (instanceId, modId) => {
      await invoke('remove_mod', { instanceId, modId });
      await get().loadInstances();
    },

    toggleMod: async (instanceId, modId) => {
      await invoke('toggle_mod', { instanceId, modId });
      await get().loadInstances();
    },

    resolveModIcons: async (instanceId) => {
      const resolved = await invoke<number>('resolve_mod_icons', { instanceId });
      await get().loadInstances();
      return resolved;
    },

    setDownloadProgress: (progress) => {
      set((state) => ({
        launcherState: { ...state.launcherState, downloadProgress: progress },
      }));
    },

    setActiveTab: (tab) => set({ activeTab: tab, selectedInstance: null }),
    setAccountSkin: (username, skinDataUrl) => set((state) => {
      const updated = state.savedAccounts.map((a) =>
        a.username === username ? { ...a, skinUrl: skinDataUrl ?? undefined } : a
      );
      invoke('save_saved_accounts', { accounts: updated }).catch(() => {});
      return { savedAccounts: updated };
    }),
    setContentCategory: (cat) => set({ contentCategory: cat }),
    setContentSource: (src) => set({ contentSource: src }),
    addSavedAccount: (account) => set((state) => {
      const filtered = state.savedAccounts.filter((a) => a.username !== account.username);
      const updated = [account, ...filtered].slice(0, 3);
      invoke('save_saved_accounts', { accounts: updated }).catch(() => {});
      return { savedAccounts: updated };
    }),
    removeSavedAccount: (username) => set((state) => {
      const updated = state.savedAccounts.filter((a) => a.username !== username);
      invoke('save_saved_accounts', { accounts: updated }).catch(() => {});
      return { savedAccounts: updated };
    }),
    setModsSourceFolder: async (instanceId, folderPath) => {
      await invoke('set_mods_source_folder', { instanceId, folderPath });
      await get().loadInstances();
    },
    setModsSourceArchive: async (instanceId, archivePath) => {
      await invoke('set_mods_source_archive', { instanceId, archivePath });
      await get().loadInstances();
    },
    setModsSourceUrl: async (instanceId, url) => {
      await invoke('set_mods_source_url', { instanceId, url });
      await get().loadInstances();
    },
    clearModsSource: async (instanceId) => {
      await invoke('clear_mods_source', { instanceId });
      await get().loadInstances();
    },
    syncModsSource: async (instanceId) => {
      const changed = await invoke<boolean>('sync_mods_source_now', { instanceId });
      await get().loadInstances();
      return changed;
    },
    syncOfficialSources: async () => {
      // Al abrir el launcher: sincroniza en silencio todas las instancias
      // con fuente por URL. Así los mods publicados por el admin aparecen
      // sin que el usuario tenga que hacer nada. Devuelve cuántas cambiaron.
      const { instances } = get();
      let changed = 0;
      for (const inst of instances) {
        if (inst.modsSource?.type === 'archive' && inst.modsSource.archiveUrl) {
          try {
            if (await invoke<boolean>('sync_mods_source_now', { instanceId: inst.id })) {
              changed += 1;
            }
          } catch {
            // Sin red o sin pack todavía: se ignora en el arranque.
          }
        }
      }
      await get().loadInstances();
      return changed;
    },
    publishModsPack: async (instanceId) => {
      const url = await invoke<string>('publish_mods_pack', { instanceId });
      await get().loadInstances();
      return url;
    },
    publishCatalog: async () => {
      const msg = await invoke<string>('publish_catalog');
      await get().loadInstances();
      return msg;
    },
    syncCatalog: async () => {
      // Catálogo oficial del servidor: las instancias publicadas por el
      // admin se crean/actualizan solas. Silencioso si no hay red o catálogo.
      // Además deja lista la suscripción de tiempo real (Supabase).
      try {
        const res = await invoke<{ changed: number; realtimeUrl: string; realtimeAnon: string }>('sync_catalog');
        if (res.changed > 0) await get().loadInstances();
        if (res.realtimeUrl && res.realtimeAnon) {
          try {
            localStorage.setItem('ltc-realtime', JSON.stringify({ url: res.realtimeUrl, anon: res.realtimeAnon }));
          } catch { /* noop */ }
          const { ensureRealtime } = await import('@/lib/supabase');
          ensureRealtime(res.realtimeUrl, res.realtimeAnon, () => get().onRealtimeCatalog());
        }
        return res.changed;
      } catch {
        return 0;
      }
    },
    onRealtimeCatalog: async () => {
      // Llega push de Supabase: recargar catálogo + mods y avisar.
      const changed = await get().syncCatalog();
      await get().syncOfficialSources().catch(() => {});
      if (changed > 0) {
        set((state) => ({
          launcherState: { ...state.launcherState, statusMessage: 'Contenido del servidor actualizado en tiempo real' },
        }));
      }
    },
    initRealtime: () => {
      // Reconecta el push con las últimas credenciales conocidas.
      try {
        const raw = localStorage.getItem('ltc-realtime');
        if (!raw) return;
        const { url, anon } = JSON.parse(raw) as { url?: string; anon?: string };
        if (url && anon) {
          import('@/lib/supabase')
            .then(({ ensureRealtime }) => ensureRealtime(url, anon, () => get().onRealtimeCatalog()))
            .catch(() => {});
        }
      } catch { /* noop */ }
    },
  };
});
