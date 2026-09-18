use super::downloader::MinecraftDownloader;
use super::manifest::VersionInfo;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModInfo {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub source: String,
    #[serde(alias = "project_id")]
    pub project_id: Option<u64>,
    #[serde(alias = "file_id")]
    pub file_id: Option<u64>,
    pub hash: String,
    pub enabled: bool,
    pub version: Option<String>,
    #[serde(default, alias = "icon_url")]
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModsSource {
    #[serde(rename = "type")]
    pub source_type: String,
    #[serde(rename = "folderPath")]
    pub folder_path: String,
    #[serde(rename = "archivePath")]
    pub archive_path: String,
    #[serde(rename = "archiveUrl")]
    pub archive_url: String,
    pub fingerprint: String,
    #[serde(rename = "remoteMeta")]
    pub remote_meta: String,
    #[serde(rename = "syncedAt")]
    pub synced_at: String,
}

impl ModsSource {
    pub const TYPE_NONE: &'static str = "none";
    pub const TYPE_FOLDER: &'static str = "folder";
    pub const TYPE_ARCHIVE: &'static str = "archive";

    pub fn new_folder(path: String) -> Self {
        Self {
            source_type: Self::TYPE_FOLDER.to_string(),
            folder_path: path,
            ..Default::default()
        }
    }

    pub fn new_archive(path: String) -> Self {
        Self {
            source_type: Self::TYPE_ARCHIVE.to_string(),
            archive_path: path,
            ..Default::default()
        }
    }

    pub fn new_url(url: String) -> Self {
        Self {
            source_type: Self::TYPE_ARCHIVE.to_string(),
            archive_url: url,
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceConfig {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    #[serde(alias = "mc_version")]
    pub mc_version: String,
    #[serde(alias = "mod_loader")]
    pub mod_loader: String,
    #[serde(alias = "mod_loader_version")]
    pub mod_loader_version: String,
    #[serde(alias = "java_version")]
    pub java_version: i32,
    #[serde(alias = "ram_min")]
    pub ram_min: String,
    #[serde(alias = "ram_max")]
    pub ram_max: String,
    #[serde(alias = "jvm_args")]
    pub jvm_args: Vec<String>,
    #[serde(alias = "server_address")]
    pub server_address: String,
    #[serde(alias = "server_port")]
    pub server_port: u16,
    pub mods: Vec<ModInfo>,
    #[serde(alias = "is_installed")]
    pub is_installed: bool,
    #[serde(default)]
    pub mods_source: Option<ModsSource>,
}

impl InstanceConfig {
    pub fn instance_dir(base: &PathBuf, id: &str) -> PathBuf {
        base.join(id)
    }

    pub fn config_path(base: &PathBuf, id: &str) -> PathBuf {
        Self::instance_dir(base, id).join("instance.json")
    }

    pub fn mods_dir(base: &PathBuf, id: &str) -> PathBuf {
        Self::instance_dir(base, id).join("mods")
    }

    pub fn load(base: &PathBuf, id: &str) -> Option<Self> {
        let path = Self::config_path(base, id);
        if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
        } else {
            None
        }
    }

    pub fn save(&self, base: &PathBuf) -> Result<(), String> {
        let dir = Self::instance_dir(base, &self.id);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = Self::config_path(base, &self.id);
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(&path, json).map_err(|e| e.to_string())
    }
}

pub struct Launcher;

/// Pack oficial de mods del servidor: viene preconfigurado en cada
/// instancia nueva y se sincroniza solo al darle a Jugar.
/// El admin lo actualiza subiendo el zip a ese release (tag fijo).
pub const DEFAULT_MODS_PACK_URL: &str =
    "https://github.com/Haroldpgr/LTC/releases/download/mods-latest/mods.zip";

impl Launcher {
    /// En Windows evita que los procesos hijo (java.exe es app de consola)
    /// abran una ventana de CMD visible. Sin esto, al darle a Jugar aparece
    /// una consola negra junto al juego.
    #[cfg(target_os = "windows")]
    pub fn hide_console(cmd: &mut Command) {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW = 0x08000000
        cmd.creation_flags(0x08000000);
    }

    #[cfg(not(target_os = "windows"))]
    pub fn hide_console(_cmd: &mut Command) {}

    pub fn find_java(java_version: i32) -> Option<PathBuf> {
        let common_paths = vec![
            format!("C:\\Program Files\\Java\\jdk-{}\\bin\\java.exe", java_version),
            format!("C:\\Program Files\\Java\\jre-{}\\bin\\java.exe", java_version),
            format!("C:\\Program Files (x86)\\Java\\jre-{}\\bin\\java.exe", java_version),
        ];

        for path in &common_paths {
            let p = PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }

        // Try JAVA_HOME
        if let Ok(home) = std::env::var("JAVA_HOME") {
            let p = PathBuf::from(home).join("bin").join("java.exe");
            if p.is_file() {
                return Some(p);
            }
        }

        // Try system java
        if let Ok(output) = {
            let mut probe = Command::new("java");
            probe.arg("-version");
            Self::hide_console(&mut probe);
            probe.output()
        } {
            if output.status.success() {
                return Some(PathBuf::from("java"));
            }
        }

        None
    }

    /// Devuelve un java.exe utilizable para la versión pedida. Si no hay ninguno
    /// instalado, descarga un JRE portable de Eclipse Temurin a runtimes_dir.
    pub async fn ensure_java(
        java_version: i32,
        app_handle: Option<&AppHandle>,
        runtimes_dir: &PathBuf,
    ) -> Result<PathBuf, String> {
        if let Some(p) = Self::find_java(java_version) {
            return Ok(p);
        }

        if ![8, 11, 17, 21].contains(&java_version) {
            return Err(format!(
                "Java {} no encontrado y sin descarga automática disponible. Instala Java {} manualmente.",
                java_version, java_version
            ));
        }

        let dir = runtimes_dir.join(format!("java-{}", java_version));
        // Por si una descarga anterior quedó a medias, buscar un java válido ya extraído
        if let Some(p) = Self::find_runtime_java(&dir) {
            if Self::java_runs(&p) {
                return Ok(p);
            }
        }

        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let url = format!(
            "https://api.adoptium.net/v3/binary/latest/{}/ga/windows/x64/jre/hotspot/normal/eclipse",
            java_version
        );
        let zip_path = dir.join(format!("temurin-jre-{}.zip", java_version));
        MinecraftDownloader::stream_download(
            &url,
            &zip_path,
            app_handle,
            &format!("Java {} Runtime", java_version),
        )
        .await?;

        Self::extract_zip_tree(&zip_path, &dir)?;
        std::fs::remove_file(&zip_path).ok();

        let java_exe = Self::find_runtime_java(&dir).ok_or_else(|| {
            format!(
                "Se descargó Java {} pero no se encontró bin\\java.exe tras extraer.",
                java_version
            )
        })?;
        if !Self::java_runs(&java_exe) {
            return Err(format!(
                "El Java {} descargado no se pudo ejecutar. Revisa tu antivirus o instala Java manualmente.",
                java_version
            ));
        }
        Ok(java_exe)
    }

    /// Busca bin/java.exe dentro del runtime (la raíz del zip varía según build).
    fn find_runtime_java(dir: &PathBuf) -> Option<PathBuf> {
        let direct = dir.join("bin").join("java.exe");
        if direct.is_file() {
            return Some(direct);
        }
        let entries = std::fs::read_dir(dir).ok()?;
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let candidate = p.join("bin").join("java.exe");
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
        None
    }

    fn java_runs(java_exe: &PathBuf) -> bool {
        let mut probe = Command::new(java_exe);
        probe.arg("-version");
        Self::hide_console(&mut probe);
        probe
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Extrae un zip preservando su estructura de carpetas.
    fn extract_zip_tree(zip_path: &PathBuf, dest: &PathBuf) -> Result<(), String> {
        let file = std::fs::File::open(zip_path)
            .map_err(|e| format!("No se pudo abrir {}: {}", zip_path.display(), e))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("ZIP inválido: {}", e))?;
        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("Error leyendo el ZIP: {}", e))?;
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().replace('\\', "/");
            // Protección básica contra zip-slip
            if name.contains("..") {
                continue;
            }
            let dest_path = dest.join(&name);
            if let Some(parent) = dest_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out =
                std::fs::File::create(&dest_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn build_classpath(
        instance_dir: &PathBuf,
        version_info: &VersionInfo,
        include_client_jar: bool,
    ) -> String {
        let mut paths = Vec::new();

        // Add libraries
        let libs_dir = instance_dir.join("libraries");
        for lib in &version_info.libraries {
            if let Some(artifact) = &lib.downloads.artifact {
                let lib_path = libs_dir.join(&artifact.path);
                if lib_path.exists() {
                    paths.push(lib_path.to_string_lossy().to_string());
                }
            }
        }

        // Add client jar (vanilla y Fabric lo necesitan en el classpath).
        // En Forge NO se añade: ModLauncher ensambla el juego (slim+extra) vía
        // UnionFS, y si se incluye hay dos módulos `minecraft` y el arranque falla
        // con ResolutionException.
        if include_client_jar {
            let client_jar = instance_dir.join("minecraft.jar");
            if client_jar.exists() {
                paths.push(client_jar.to_string_lossy().to_string());
            }
        }

        paths.join(";")
    }

    pub fn build_launch_command(
        instance_dir: &PathBuf,
        config: &InstanceConfig,
        version_info: &VersionInfo,
        username: &str,
        uuid: &str,
        access_token: &str,
        java_path: &PathBuf,
    ) -> Command {
        let classpath =
            Self::build_classpath(instance_dir, version_info, config.mod_loader != "forge");
        let assets_dir = instance_dir.join("assets");
        let natives_dir = instance_dir.join("natives");

        let mut args = Vec::new();

        // JVM args. El heap INICIAL se limita a 1G (o menos si así se configuró)
        // para un arranque rápido y bajo consumo base: reservar los 4G de golpe
        // congela el inicio (el SO debe comprometer toda la memoria). El heap
        // crece solo hasta el máximo configurado según lo pida el juego.
        args.push(format!("-Xms{}", Self::initial_heap(&config.ram_min)));
        args.push(format!("-Xmx{}", config.ram_max));
        args.push(format!("-Djava.library.path={}", natives_dir.to_string_lossy()));

        // Flags de rendimiento (GC G1 afinado para modpacks; el usuario puede
        // sobreescribirlos con sus propios argumentos JVM)
        args.push("-XX:+UseG1GC".to_string());
        args.push("-XX:+ParallelRefProcEnabled".to_string());
        args.push("-XX:MaxGCPauseMillis=200".to_string());
        args.push("-XX:+UnlockExperimentalVMOptions".to_string());
        args.push("-XX:+DisableExplicitGC".to_string());
        args.push("-XX:G1NewSizePercent=30".to_string());
        args.push("-XX:G1MaxNewSizePercent=40".to_string());
        args.push("-XX:G1HeapRegionSize=8M".to_string());
        args.push("-XX:G1ReservePercent=20".to_string());

        // Custom JVM args
        for arg in &config.jvm_args {
            args.push(arg.clone());
        }

        // JVM args del json de versión (Forge necesita -p, --add-opens etc.)
        if let Some(arguments) = &version_info.arguments {
            let libs_dir = instance_dir.join("libraries");
            for arg in &arguments.jvm {
                for s in Self::expand_jvm_arg(arg, &natives_dir, &libs_dir, &version_info.id) {
                    args.push(s);
                }
            }
        }

        // Classpath
        args.push("-cp".to_string());
        args.push(classpath);

        // Main class
        args.push(version_info.main_class.clone());

        // Game arguments from version info
        if let Some(arguments) = &version_info.arguments {
            for arg in &arguments.game {
                if let Some(s) = arg.as_str() {
                    args.push(Self::replace_game_args(
                        s,
                        username,
                        uuid,
                        access_token,
                        &config.mc_version,
                        &version_info.assets,
                        &assets_dir,
                        instance_dir,
                    ));
                }
            }
        } else if let Some(mc_args) = &version_info.minecraft_arguments {
            let parts: Vec<&str> = mc_args.split_whitespace().collect();
            let mut i = 0;
            while i < parts.len() {
                let arg = Self::replace_game_args(
                    parts[i],
                    username,
                    uuid,
                    access_token,
                    &config.mc_version,
                    &version_info.assets,
                    &assets_dir,
                    instance_dir,
                );
                args.push(arg);
                i += 1;
            }
        }

        // Auto-join al servidor: las opciones clásicas --server/--port fueron
        // eliminadas por Mojang (el juego las ignora: "Completely ignored
        // arguments"). La vía actual es --quickPlayMultiplayer "host:port".
        if !config.server_address.is_empty() {
            args.push("--quickPlayMultiplayer".to_string());
            args.push(format!("{}:{}", config.server_address, config.server_port));
        }

        let mut cmd = Command::new(java_path);
        cmd.args(&args).current_dir(instance_dir);
        // Sin ventana de consola y sin heredar stdio: el juego escribe sus
        // propios logs en la instancia y así el arranque es limpio y fluido.
        Self::hide_console(&mut cmd);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        cmd
    }

    /// Heap inicial: 1G como máximo para no congelar el arranque. Si el mínimo
    /// configurado ya es menor o igual, se respeta tal cual.
    fn initial_heap(ram_min: &str) -> String {
        fn megas(s: &str) -> Option<u64> {
            let t = s.trim().to_uppercase();
            if let Some(v) = t.strip_suffix('G') {
                v.trim().parse::<u64>().ok().map(|n| n * 1024)
            } else if let Some(v) = t.strip_suffix('M') {
                v.trim().parse::<u64>().ok()
            } else {
                None
            }
        }
        match megas(ram_min) {
            Some(mb) if mb <= 1024 => ram_min.to_string(),
            _ => "1G".to_string(),
        }
    }

    /// Expande una entrada de arguments.jvm (string o {rules, value}) a sus valores
    /// finales, evaluando reglas de SO y sustituyendo placeholders.
    fn expand_jvm_arg(
        arg: &serde_json::Value,
        natives_dir: &PathBuf,
        libs_dir: &PathBuf,
        version_id: &str,
    ) -> Vec<String> {
        if let Some(s) = arg.as_str() {
            return vec![Self::replace_jvm_placeholders(s, natives_dir, libs_dir, version_id)];
        }
        let Some(obj) = arg.as_object() else {
            return Vec::new();
        };
        if !Self::jvm_entry_allowed(obj) {
            return Vec::new();
        }
        match obj.get("value") {
            Some(serde_json::Value::String(s)) => {
                vec![Self::replace_jvm_placeholders(s, natives_dir, libs_dir, version_id)]
            }
            Some(serde_json::Value::Array(arr)) => arr
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| Self::replace_jvm_placeholders(s, natives_dir, libs_dir, version_id))
                .collect(),
            _ => Vec::new(),
        }
    }

    /// Evalúa las rules de una entrada jvm: solo SO conocido (Windows). Las reglas
    /// por features (demo, resolución custom...) se omiten porque no aplican.
    fn jvm_entry_allowed(obj: &serde_json::Map<String, serde_json::Value>) -> bool {
        let Some(rules) = obj.get("rules").and_then(|r| r.as_array()) else {
            return true;
        };
        let mut allowed = false;
        for rule in rules {
            if rule.get("features").is_some() {
                continue;
            }
            let action = rule.get("action").and_then(|a| a.as_str()).unwrap_or("");
            let os_ok = match rule.get("os") {
                None => true,
                Some(os) => {
                    let name_ok = os
                        .get("name")
                        .and_then(|n| n.as_str())
                        .map(|n| n == "windows")
                        .unwrap_or(true);
                    let arch_ok = os
                        .get("arch")
                        .and_then(|a| a.as_str())
                        .map(|a| a == "x64" || a == "x86_64")
                        .unwrap_or(true);
                    name_ok && arch_ok
                }
            };
            if !os_ok {
                continue;
            }
            if action == "allow" {
                allowed = true;
            } else if action == "disallow" {
                allowed = false;
            }
        }
        allowed
    }

    fn replace_jvm_placeholders(
        arg: &str,
        natives_dir: &PathBuf,
        libs_dir: &PathBuf,
        version_id: &str,
    ) -> String {
        arg.replace("${natives_directory}", &natives_dir.to_string_lossy())
            .replace("${library_directory}", &libs_dir.to_string_lossy())
            .replace("${version_name}", version_id)
            .replace("${launcher_name}", "LTC Launcher")
            .replace("${launcher_version}", "1.0.0")
            .replace("${classpath_separator}", ";")
    }

    fn replace_game_args(
        arg: &str,
        username: &str,
        uuid: &str,
        access_token: &str,
        version: &str,
        assets_index: &str,
        assets_dir: &PathBuf,
        game_dir: &PathBuf,
    ) -> String {
        arg.replace("${auth_player_name}", username)
            .replace("${version_name}", version)
            .replace("${game_directory}", &game_dir.to_string_lossy())
            .replace("${assets_root}", &assets_dir.to_string_lossy())
            .replace("${game_assets}", &assets_dir.to_string_lossy())
            .replace("${assets_index_name}", assets_index)
            .replace("${auth_uuid}", uuid)
            .replace("${auth_access_token}", access_token)
            .replace("${user_type}", "msa")
            .replace("${version_type}", "release")
            .replace("${user_properties}", "{}")
    }

    pub fn hash_file(path: &PathBuf) -> Result<String, String> {
        let data = std::fs::read(path).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        hasher.update(&data);
        let result = hasher.finalize();
        Ok(format!("{:x}", result))
    }
}

#[allow(dead_code)]
pub fn generate_uuid() -> String {
    let uuid = Uuid::new_v4();
    uuid.to_string().replace("-", "")
}
