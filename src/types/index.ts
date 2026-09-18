export interface MinecraftAccount {
  type: 'microsoft' | 'offline';
  username: string;
  uuid: string;
  accessToken?: string;
  skinUrl?: string;
  isLoggedIn: boolean;
}

export interface Mod {
  id: string;
  name: string;
  filename: string;
  source: 'local' | 'curseforge';
  projectId?: number;
  fileId?: number;
  hash: string;
  enabled: boolean;
  version?: string;
  iconUrl?: string;
}

export interface ModsSource {
  type: 'none' | 'folder' | 'archive';
  folderPath: string;
  archivePath: string;
  archiveUrl: string;
  fingerprint: string;
  remoteMeta: string;
  syncedAt: string;
}

export interface ModpackInstance {
  id: string;
  name: string;
  icon: string;
  description: string;
  mcVersion: string;
  modLoader: 'forge' | 'fabric' | 'none';
  modLoaderVersion: string;
  javaVersion: number;
  ramMin: string;
  ramMax: string;
  jvmArgs: string[];
  serverAddress: string;
  serverPort: number;
  mods: Mod[];
  isInstalled: boolean;
  isUpdating: boolean;
  lastPlayed?: string;
  modsSource?: ModsSource;
}

export interface LauncherConfig {
  instancesDir: string;
  curseforgeApiKey: string;
  adminPassword: string;
  autoUpdate: boolean;
  theme: 'dark' | 'light';
  language: string;
  maxConcurrentDownloads: number;
}

export interface DownloadProgress {
  fileName: string;
  current: number;
  total: number;
  percentage: number;
  speed: number;
}

export interface LauncherState {
  isLaunching: boolean;
  isInstalling: boolean;
  downloadProgress: DownloadProgress | null;
  statusMessage: string;
  error: string | null;
}
