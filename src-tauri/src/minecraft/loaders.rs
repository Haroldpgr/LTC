use super::downloader::MinecraftDownloader;
use super::launcher::InstanceConfig;
use super::manifest::{Arguments, Artifact, AssetIndex, Downloads, Library, LibraryDownloads, VersionInfo};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("LTC-Launcher/1.0.0 (contact@ltc.dev)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Lista de versiones de Forge disponibles para un MC (más nuevas primero),
/// leída del maven-metadata oficial.
#[tauri::command]
pub async fn list_forge_versions(mc_version: String) -> Result<Vec<String>, String> {
    let mc = mc_version.trim();
    let text = http_client()
        .get("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml")
        .send()
        .await
        .map_err(|e| format!("Error consultando versiones de Forge: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Error leyendo versiones de Forge: {}", e))?;

    let prefix = format!("{}-", mc);
    let mut out: Vec<String> = Vec::new();
    let mut rest = text.as_str();
    while let Some(s) = rest.find("<version>") {
        rest = &rest[s + 9..];
        if let Some(e) = rest.find("</version>") {
            let full = rest[..e].trim();
            if let Some(stripped) = full.strip_prefix(&prefix) {
                if !stripped.is_empty() {
                    out.push(stripped.to_string());
                }
            }
            rest = &rest[e + 10..];
        } else {
            break;
        }
    }
    out.sort_by(|a, b| compare_versions(b, a));
    out.dedup();
    Ok(out)
}

fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let nums = |s: &str| -> Vec<u64> {
        s.split(|c: char| !c.is_ascii_digit())
            .filter(|p| !p.is_empty())
            .filter_map(|p| p.parse().ok())
            .collect()
    };
    let (pa, pb) = (nums(a), nums(b));
    for (x, y) in pa.iter().zip(pb.iter()) {
        match x.cmp(y) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    pa.len().cmp(&pb.len()).then_with(|| a.cmp(b))
}

#[derive(Debug, Clone, Serialize)]
pub struct FabricVersionOption {
    pub version: String,
    pub stable: bool,
}

/// Lista de loaders de Fabric disponibles para un MC (estables primero).
#[tauri::command]
pub async fn list_fabric_versions(mc_version: String) -> Result<Vec<FabricVersionOption>, String> {
    let mc = mc_version.trim();
    let url = format!("https://meta.fabricmc.net/v2/versions/loader/{}", mc);
    let list: Vec<FabricVersionEntry> = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Error consultando versiones de Fabric: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Error parseando versiones de Fabric: {}", e))?;
    let mut out: Vec<FabricVersionOption> = list
        .into_iter()
        .map(|e| FabricVersionOption {
            version: e.loader.version,
            stable: e.loader.stable,
        })
        .collect();
    out.sort_by(|a, b| b.stable.cmp(&a.stable));
    Ok(out)
}

/// Versión recomendada de Forge para un MC según promotions_slim.json.
async fn recommended_forge_version(mc_version: &str) -> Result<String, String> {
    let mc = mc_version.trim();
    let v: serde_json::Value = http_client()
        .get("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json")
        .send()
        .await
        .map_err(|e| format!("Error consultando Forge recomendado: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Error parseando Forge recomendado: {}", e))?;
    let promos = v
        .get("promos")
        .ok_or("Respuesta de Forge sin promociones")?;
    for key in [format!("{}-recommended", mc), format!("{}-latest", mc)] {
        if let Some(s) = promos.get(&key).and_then(|x| x.as_str()) {
            if !s.is_empty() {
                return Ok(s.to_string());
            }
        }
    }
    Err(format!(
        "No hay versión recomendada de Forge para MC {}. Elige una manualmente.",
        mc
    ))
}

fn emit_status(app_handle: &AppHandle, message: &str) {
    let _ = app_handle.emit(
        "install-status",
        serde_json::json!({ "message": message }),
    );
}

/// Instala el mod loader configurado (forge / fabric) dentro de instance_dir.
/// Para "none" u otros no hace nada.
pub async fn install_loader(
    mod_loader: &str,
    mod_loader_version: &str,
    mc_version: &str,
    instance_dir: &PathBuf,
    base_dir: &PathBuf,
    instance_id: &str,
    java_exe: &PathBuf,
    app_handle: &AppHandle,
) -> Result<(), String> {
    match mod_loader {
        "forge" => {
            install_forge(
                mod_loader_version,
                mc_version,
                instance_dir,
                base_dir,
                instance_id,
                java_exe,
                app_handle,
            )
            .await
        }
        "fabric" => install_fabric(mod_loader_version, mc_version, instance_dir, app_handle).await,
        _ => Ok(()),
    }
}

/// Comprueba si el loader configurado está instalado; si no, lo instala ahora
/// (para que cambiar de versión + Play funcione sin pasos manuales).
/// Devuelve true si instaló algo.
#[allow(clippy::too_many_arguments)]
pub async fn ensure_loader_ready(
    mod_loader: &str,
    mod_loader_version: &str,
    mc_version: &str,
    java_version: i32,
    instance_dir: &PathBuf,
    base_dir: &PathBuf,
    instance_id: &str,
    runtimes_dir: &PathBuf,
    app_handle: &AppHandle,
) -> Result<bool, String> {
    let ready = match mod_loader {
        "forge" => {
            let fv = mod_loader_version.trim();
            if fv.is_empty() {
                false
            } else {
                let expected = format!("{}-forge-{}", mc_version.trim(), fv);
                instance_dir
                    .join("versions")
                    .join(&expected)
                    .join(format!("{}.json", expected))
                    .is_file()
            }
        }
        "fabric" => {
            let p = instance_dir.join("loader.json");
            if !p.is_file() {
                false
            } else {
                match std::fs::read_to_string(&p)
                    .ok()
                    .and_then(|c| serde_json::from_str::<SavedLoaderMeta>(&c).ok())
                {
                    Some(m) => {
                        m.mc_version == mc_version.trim()
                            && (mod_loader_version.trim().is_empty()
                                || m.loader_version == mod_loader_version.trim())
                    }
                    None => false,
                }
            }
        }
        _ => true,
    };
    if ready {
        return Ok(false);
    }
    if !instance_dir.join("minecraft.jar").is_file() {
        return Err("Faltan los archivos base del juego. Pulsa Instalar primero.".to_string());
    }
    emit_status(
        app_handle,
        "Detectado cambio de loader: instalando la versión configurada...",
    );
    let java_exe =
        super::launcher::Launcher::ensure_java(java_version, Some(app_handle), runtimes_dir).await?;
    install_loader(
        mod_loader,
        mod_loader_version,
        mc_version,
        instance_dir,
        base_dir,
        instance_id,
        &java_exe,
        app_handle,
    )
    .await?;
    Ok(true)
}

/// Resuelve el VersionInfo efectivo para lanzar: Forge usa su propio json,
/// Fabric combina el vanilla con sus librerías, el resto usa el vanilla.
pub async fn resolve_version_info(
    instance_dir: &PathBuf,
    mod_loader: &str,
    mod_loader_version: &str,
    mc_version: &str,
) -> Result<VersionInfo, String> {
    match mod_loader {
        "forge" => {
            let fv = mod_loader_version.trim();
            if fv.is_empty() {
                return Err("Esta instancia es Forge pero no tiene versión configurada. Edítala en el panel admin.".to_string());
            }
            let expected = format!("{}-forge-{}", mc_version.trim(), fv);
            // Caché válida solo si coincide con la versión configurada, trae los
            // args completos y no tiene artefactos duplicados (las cachés viejas
            // mezclaban varias versiones de las mismas librerías).
            let cached = instance_dir.join("forge-version.json");
            if cached.is_file() {
                if let Ok(content) = std::fs::read_to_string(&cached) {
                    if let Ok(info) = serde_json::from_str::<VersionInfo>(&content) {
                        let has_user = info
                            .arguments
                            .as_ref()
                            .map(|a| a.game.iter().any(|g| g.as_str() == Some("--username")))
                            .unwrap_or(false);
                        if info.id == expected && has_user && !has_duplicate_artifacts(&info) {
                            return Ok(info);
                        }
                    }
                }
            }
            // Directorio exacto de la versión configurada
            let exact = instance_dir
                .join("versions")
                .join(&expected)
                .join(format!("{}.json", expected));
            if exact.is_file() {
                let content = std::fs::read_to_string(&exact).map_err(|e| e.to_string())?;
                let info = merge_forge_json(&content, mc_version).await?;
                if let Ok(json) = serde_json::to_string_pretty(&info) {
                    std::fs::write(instance_dir.join("forge-version.json"), json).ok();
                }
                return Ok(info);
            }
            if find_forge_version_json(instance_dir).is_some() {
                return Err(format!(
                    "Hay otra versión de Forge instalada, pero la instancia pide {}. Pulsa Instalar para instalarla.",
                    expected
                ));
            }
            Err("Forge no está instalado en esta instancia. Pulsa Instalar para instalarlo.".to_string())
        }
        "fabric" => {
            let mut info = MinecraftDownloader::get_version_info(mc_version).await?;
            apply_fabric_loader(instance_dir, &mut info)?;
            Ok(info)
        }
        _ => MinecraftDownloader::get_version_info(mc_version).await,
    }
}

// ---------------------------------------------------------------------------
// Forge
// ---------------------------------------------------------------------------

/// Busca el json de versión que genera el instalador de Forge en versions/.
pub fn find_forge_version_json(instance_dir: &PathBuf) -> Option<PathBuf> {
    let versions = instance_dir.join("versions");
    let entries = std::fs::read_dir(&versions).ok()?;
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let name = dir.file_name()?.to_string_lossy().to_lowercase();
        if !name.contains("forge") {
            continue;
        }
        if let Some(base) = dir.file_name().and_then(|n| n.to_str()) {
            let candidate = dir.join(format!("{}.json", base));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        if let Ok(inner) = std::fs::read_dir(&dir) {
            for f in inner.flatten() {
                let p = f.path();
                if p.extension().and_then(|e| e.to_str()) == Some("json") {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// Detecta si un VersionInfo tiene el mismo artefacto en varias versiones.
fn has_duplicate_artifacts(info: &VersionInfo) -> bool {
    let mut seen = HashSet::new();
    for lib in &info.libraries {
        let key = lib
            .name
            .rsplit_once(':')
            .map(|(base, _)| base.to_string())
            .unwrap_or_else(|| lib.name.clone());
        if !seen.insert(key) {
            return true;
        }
    }
    false
}

/// Versión parcial/tolerante del json de Forge (sirve para antiguos con
/// inheritsFrom y modernos autocontenidos).
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
struct PartialVersion {
    #[serde(default)]
    id: String,
    #[serde(default, rename = "mainClass")]
    main_class: String,
    #[serde(default, rename = "minecraftArguments")]
    minecraft_arguments: Option<String>,
    #[serde(default)]
    arguments: Option<Arguments>,
    #[serde(default)]
    libraries: Vec<Library>,
    #[serde(default, rename = "inheritsFrom")]
    inherits_from: Option<String>,
    #[serde(default, rename = "assetIndex")]
    asset_index: Option<AssetIndex>,
    #[serde(default)]
    assets: Option<String>,
    #[serde(default)]
    downloads: Option<Downloads>,
}

async fn merge_forge_json(content: &str, mc_version: &str) -> Result<VersionInfo, String> {
    let partial: PartialVersion =
        serde_json::from_str(content).map_err(|e| format!("JSON de Forge inválido: {}", e))?;
    // El padre vanilla aporta lo que falte (necesario en Forge antiguos con inheritsFrom).
    let parent = MinecraftDownloader::get_version_info(mc_version).await?;

    // Deduplicar por artefacto (grupo:artefacto), quedándonos con la primera
    // aparición (las de Forge). Sin esto conviven gson/guava/asm/etc. en varias
    // versiones: más jars que escanear, más RAM y conflictos de clases.
    let mut seen = HashSet::new();
    let mut libraries: Vec<Library> = Vec::new();
    for lib in partial.libraries.into_iter().chain(parent.libraries.clone()) {
        let key = lib
            .name
            .rsplit_once(':')
            .map(|(base, _)| base.to_string())
            .unwrap_or_else(|| lib.name.clone());
        if seen.insert(key) {
            libraries.push(lib);
        }
    }

    // Los args se CONCATENAN (padre primero): solo con los de Forge faltarían
    // --username, --accessToken, --version, etc. y el juego no arranca.
    let arguments = match (partial.arguments, parent.arguments.clone()) {
        (Some(mut child_args), Some(parent_args)) => {
            let mut game = parent_args.game;
            game.extend(child_args.game);
            child_args.game = game;
            let mut jvm = parent_args.jvm;
            jvm.extend(child_args.jvm);
            child_args.jvm = jvm;
            Some(child_args)
        }
        (Some(child_args), None) => Some(child_args),
        (None, parent_args) => parent_args,
    };

    Ok(VersionInfo {
        id: if partial.id.is_empty() {
            parent.id.clone()
        } else {
            partial.id
        },
        version_type: parent.version_type.clone(),
        main_class: if partial.main_class.is_empty() {
            parent.main_class.clone()
        } else {
            partial.main_class
        },
        minecraft_arguments: partial
            .minecraft_arguments
            .or(parent.minecraft_arguments.clone()),
        arguments,
        libraries,
        asset_index: partial
            .asset_index
            .unwrap_or_else(|| parent.asset_index.clone()),
        assets: partial.assets.unwrap_or_else(|| parent.assets.clone()),
        downloads: partial.downloads.unwrap_or_else(|| parent.downloads.clone()),
        java_version: parent.java_version.clone(),
    })
}

#[allow(clippy::too_many_arguments)]
async fn install_forge(
    forge_version: &str,
    mc_version: &str,
    instance_dir: &PathBuf,
    base_dir: &PathBuf,
    instance_id: &str,
    java_exe: &PathBuf,
    app_handle: &AppHandle,
) -> Result<(), String> {
    let mc = mc_version.trim();
    let mut fv = forge_version.trim().to_string();
    if fv.is_empty() {
        fv = recommended_forge_version(mc).await?;
        emit_status(
            app_handle,
            &format!("Versión de Forge automática: {}", fv),
        );
    }

    emit_status(app_handle, &format!("Descargando instalador de Forge {}...", fv));
    let url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{}-{}/forge-{}-{}-installer.jar",
        mc, fv, mc, fv
    );
    let installer = instance_dir.join("forge-installer.jar");
    MinecraftDownloader::stream_download(&url, &installer, Some(app_handle), "Forge Installer").await?;

    // El instalador de Forge exige un launcher_profiles.json en la carpeta destino.
    // Si no existe, falla con "you need to run the launcher first!".
    ensure_launcher_profile(instance_dir)?;

    emit_status(
        app_handle,
        "Instalando Forge, esto puede tardar varios minutos...",
    );
    let java_exe = java_exe.clone();
    let game_dir = instance_dir.clone();
    let installer_arg = installer.clone();
    let ah = app_handle.clone();
    let res: Result<(), String> = tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};

        let mut child = Command::new(&java_exe)
            .arg("-jar")
            .arg(&installer_arg)
            .arg("--installClient")
            .arg(&game_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("No se pudo ejecutar el instalador de Forge: {}", e))?;

        // Reenviar progreso del instalador a la interfaz
        let mut tail: Vec<String> = Vec::new();
        if let Some(out) = child.stdout.take() {
            for line in BufReader::new(out).lines().flatten() {
                let short = line.trim();
                if !short.is_empty() {
                    let _ = ah.emit(
                        "install-status",
                        serde_json::json!({ "message": format!("Forge: {}", short) }),
                    );
                    tail.push(short.to_string());
                    if tail.len() > 25 {
                        tail.remove(0);
                    }
                }
            }
        }
        let mut err_text = String::new();
        if let Some(err) = child.stderr.take() {
            err_text = std::io::read_to_string(err).unwrap_or_default();
        }
        let status = child
            .wait()
            .map_err(|e| format!("Error esperando al instalador de Forge: {}", e))?;
        if !status.success() {
            let detail: String = tail.iter().rev().take(8).cloned().collect::<Vec<_>>().join(" | ");
            let err_tail: String = err_text.lines().rev().take(8).collect::<Vec<_>>().join(" | ");
            return Err(format!(
                "El instalador de Forge falló (código {:?}). {} {}",
                status.code(),
                detail,
                err_tail
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Error ejecutando instalador de Forge: {}", e))?;

    std::fs::remove_file(&installer).ok();
    res?;

    let json_path = find_forge_version_json(instance_dir).ok_or_else(|| {
        "El instalador de Forge terminó pero no se encontró su versión. Revisa la versión de Forge configurada.".to_string()
    })?;

    // Nativas según el json de Forge (pueden diferir de las vanilla)
    emit_status(app_handle, "Descargando nativas de Forge...");
    let content = std::fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    let info = merge_forge_json(&content, mc).await?;
    MinecraftDownloader::download_natives(&info, instance_dir, Some(app_handle)).await?;

    // Cachear la versión fusionada para lanzar sin internet
    if let Ok(json) = serde_json::to_string_pretty(&info) {
        std::fs::write(instance_dir.join("forge-version.json"), json).ok();
    }

    // Guardar la versión efectiva en la config (por si fue automática)
    if let Some(mut cfg) = InstanceConfig::load(base_dir, instance_id) {
        cfg.mod_loader_version = fv.clone();
        let _ = cfg.save(base_dir);
    }

    emit_status(app_handle, "Forge instalado correctamente.");
    Ok(())
}

/// Crea un launcher_profiles.json mínimo si no existe. El instalador de Forge
/// lo exige en la carpeta destino ("you need to run the launcher first!").
fn ensure_launcher_profile(instance_dir: &PathBuf) -> Result<(), String> {
    let path = instance_dir.join("launcher_profiles.json");
    if path.is_file() {
        return Ok(());
    }
    let stub = r#"{"profiles": {"(Default)": {"name": "(Default)", "type": "latest-release"}}, "selectedProfile": "(Default)"}"#;
    std::fs::write(&path, stub).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Fabric
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
struct FabricRef {
    version: String,
    stable: bool,
    maven: String,
}

#[derive(Debug, Clone, Deserialize)]
struct FabricMainClass {
    client: String,
    #[allow(dead_code)]
    server: String,
}

#[derive(Debug, Clone, Deserialize)]
struct FabricLib {
    name: String,
    url: String,
}

#[derive(Debug, Clone, Deserialize)]
struct FabricLibs {
    #[serde(default)]
    client: Vec<FabricLib>,
    #[serde(default)]
    common: Vec<FabricLib>,
}

#[derive(Debug, Clone, Deserialize)]
struct FabricLauncherMeta {
    #[serde(rename = "mainClass")]
    main_class: FabricMainClass,
    libraries: FabricLibs,
}

#[derive(Debug, Clone, Deserialize)]
struct FabricVersionEntry {
    loader: FabricRef,
    #[allow(dead_code)]
    intermediary: FabricRef,
    #[serde(rename = "launcherMeta")]
    launcher_meta: FabricLauncherMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedLoaderLib {
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedLoaderMeta {
    #[serde(rename = "mainClass")]
    main_class: String,
    libraries: Vec<SavedLoaderLib>,
    #[serde(default, rename = "mcVersion")]
    mc_version: String,
    #[serde(default, rename = "loaderVersion")]
    loader_version: String,
}

fn maven_path(coord: &str) -> Option<String> {
    let mut parts = coord.split(':');
    let group = parts.next()?;
    let artifact = parts.next()?;
    let version = parts.next()?;
    Some(format!(
        "{}/{}/{}/{}-{}.jar",
        group.replace('.', "/"),
        artifact,
        version,
        artifact,
        version
    ))
}

async fn install_fabric(
    loader_version: &str,
    mc_version: &str,
    instance_dir: &PathBuf,
    app_handle: &AppHandle,
) -> Result<(), String> {
    let mc = mc_version.trim();
    emit_status(app_handle, "Obteniendo metadatos de Fabric...");

    let client = reqwest::Client::builder()
        .user_agent("LTC-Launcher/1.0.0 (contact@ltc.dev)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let lv = loader_version.trim();
    let entry: FabricVersionEntry = if lv.is_empty() {
        let url = format!("https://meta.fabricmc.net/v2/versions/loader/{}", mc);
        let mut list: Vec<FabricVersionEntry> = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Error consultando versiones de Fabric: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Error parseando versiones de Fabric: {}", e))?;
        if list.is_empty() {
            return Err(format!("No hay loaders de Fabric para Minecraft {}", mc));
        }
        let pos = list.iter().position(|e| e.loader.stable).unwrap_or(0);
        list.remove(pos)
    } else {
        let url = format!(
            "https://meta.fabricmc.net/v2/versions/loader/{}/{}",
            mc,
            urlencoding::encode(lv)
        );
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Error consultando Fabric {}: {}", lv, e))?;
        if !resp.status().is_success() {
            return Err(format!(
                "Versión de Fabric '{}' no encontrada para MC {} (HTTP {})",
                lv,
                mc,
                resp.status()
            ));
        }
        resp.json()
            .await
            .map_err(|e| format!("Error parseando versión de Fabric: {}", e))?
    };

    let libs_dir = instance_dir.join("libraries");
    let mut saved: Vec<SavedLoaderLib> = Vec::new();
    for lib in entry
        .launcher_meta
        .libraries
        .client
        .iter()
        .chain(entry.launcher_meta.libraries.common.iter())
    {
        let rel = maven_path(&lib.name)
            .ok_or_else(|| format!("Coordenada Maven inválida: {}", lib.name))?;
        let url = format!("{}/{}", lib.url.trim_end_matches('/'), rel);
        let dest = libs_dir.join(&rel);
        MinecraftDownloader::download_file(
            &url,
            &dest,
            None,
            Some(app_handle),
            &format!("Fabric {}", lib.name),
        )
        .await?;
        saved.push(SavedLoaderLib { path: rel });
    }

    let meta = SavedLoaderMeta {
        main_class: entry.launcher_meta.main_class.client.clone(),
        libraries: saved,
        mc_version: mc.to_string(),
        loader_version: entry.loader.version.clone(),
    };
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(instance_dir.join("loader.json"), json).map_err(|e| e.to_string())?;

    emit_status(app_handle, "Fabric instalado correctamente.");
    Ok(())
}

/// Aplica el loader de Fabric guardado (loader.json) sobre un VersionInfo vanilla.
pub fn apply_fabric_loader(instance_dir: &PathBuf, info: &mut VersionInfo) -> Result<(), String> {
    let content = std::fs::read_to_string(instance_dir.join("loader.json"))
        .map_err(|_| "Fabric no está instalado en esta instancia. Pulsa Instalar para instalarlo.".to_string())?;
    let meta: SavedLoaderMeta =
        serde_json::from_str(&content).map_err(|e| format!("loader.json inválido: {}", e))?;
    info.main_class = meta.main_class;
    for lib in meta.libraries {
        info.libraries.push(Library {
            name: format!("fabric:{}", lib.path),
            downloads: LibraryDownloads {
                artifact: Some(Artifact {
                    path: lib.path,
                    url: String::new(),
                    sha1: String::new(),
                    size: 0,
                }),
                classifiers: None,
            },
            rules: None,
            natives: None,
        });
    }
    Ok(())
}
