use crate::commands::instance::InstanceState;
use serde::Serialize;
use std::cmp::Ordering;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{Emitter, State};

/// Localiza la raíz del proyecto (necesaria para compilar+publicar).
/// Funciona desde `tauri dev` (exe en target/debug). Desde el launcher
/// instalado no hay repo y se devuelve None.
fn find_repo_root() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            candidates.push(d.to_path_buf());
            let mut up = d.to_path_buf();
            for _ in 0..3 {
                if up.pop() {
                    candidates.push(up.clone());
                }
            }
        }
    }
    candidates.into_iter().find(|c| {
        c.join("src-tauri").join("tauri.conf.json").is_file()
            && c.join("scripts").join("publish-update.mjs").is_file()
    })
}

fn valid_version(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// Compila el instalador y publica el release en GitHub con tu token,
/// en UNA VENTANA APARTE (nueva consola). Tiene que ser así porque al
/// cambiar la versión, `tauri dev` reinicia el launcher y mataría el
/// proceso si corriera dentro. Progreso en esa ventana; al terminar,
/// el release queda subido solo.
#[tauri::command]
pub async fn start_publish_release(
    version: String,
    notes: String,
    app_handle: tauri::AppHandle,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<String, String> {
    let version = version.trim().to_string();
    if !valid_version(&version) {
        return Err("Versión inválida: usa formato X.Y.Z (ej. 1.0.2).".to_string());
    }
    // Evita publicar hacia atrás por error (la actual va compilada dentro).
    if compare_versions(&version, env!("CARGO_PKG_VERSION")) != Ordering::Greater {
        return Err(format!(
            "La versión debe ser mayor que la actual ({}).",
            env!("CARGO_PKG_VERSION")
        ));
    }

    let has_token = {
        let state_lock = state.lock().map_err(|e| e.to_string())?;
        !state_lock.config.github_token.trim().is_empty()
    };
    if !has_token {
        return Err("Falta el token de GitHub: configúralo en el Pack de mods primero.".to_string());
    }
    let Some(root) = find_repo_root() else {
        return Err("No se encontró el proyecto: abre el launcher con `npm run tauri dev` o publica con `npm run publish:update`.".to_string());
    };
    let ps1 = root.join("scripts").join("publish-release-window.ps1");
    if !ps1.is_file() {
        return Err("Falta scripts/publish-release-window.ps1 en el proyecto.".to_string());
    }

    let mut notes_arg = if notes.trim().is_empty() {
        format!("Actualización v{}", version)
    } else {
        notes.trim().to_string()
    };
    // Saneado para viajar como argumento entre cmd/start/powershell:
    // sin comillas ni saltos de línea (romperían las capas de citado).
    notes_arg = notes_arg.replace(['"', '\r', '\n'], " ");

    // Ventana de consola nueva y separada: sobrevive aunque el launcher
    // se reinicie a mitad del build. Sin pipes (no se puede colgar).
    // Se intenta escapar del job de `tauri dev` (si lo hubiera) para que
    // al reiniciar la app no arrastre a esta ventana; si falla, reintento normal.
    #[cfg(target_os = "windows")]
    fn spawn_window(ps1: &str, version: &str, notes: &str, root: &PathBuf) -> std::io::Result<()> {
        use std::os::windows::process::CommandExt;
        let attempt = |flags: u32| {
            let mut cmd = std::process::Command::new("powershell");
            cmd.args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                ps1,
                "-Version",
                version,
                "-Notes",
                notes,
            ]);
            cmd.current_dir(root)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            cmd.creation_flags(flags);
            cmd.spawn().map(|_| ())
        };
        // BREAKAWAY_FROM_JOB | DETACHED | NEW_GROUP | NEW_CONSOLE
        attempt(0x01000000 | 0x00000008 | 0x00000200 | 0x00000010)
            .or_else(|_| attempt(0x00000010))
    }

    #[cfg(not(target_os = "windows"))]
    fn spawn_window(_ps1: &str, _version: &str, _notes: &str, _root: &PathBuf) -> std::io::Result<()> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "solo Windows",
        ))
    }

    match spawn_window(
        &ps1.to_string_lossy().to_string(),
        &version,
        &notes_arg,
        &root,
    ) {
        Ok(_) => {
            let _ = app_handle.emit(
                "release-done",
                serde_json::json!({ "ok": true, "message": "Ventana de publicación abierta: NO la cierres, ahí sale el progreso. El launcher se reiniciará solo a mitad (es normal) y volverá." }),
            );
            Ok("Ventana de publicación abierta.".to_string())
        }
        Err(e) => Err(format!("No se pudo abrir la ventana de publicación: {}", e)),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub installer_url: String,
    pub current_version: String,
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

/// Lee el JSON de actualización publicado por el admin.
/// Formato: { "version": "1.1.0", "notes": "...", "installerUrl": "https://..." }
#[tauri::command]
pub async fn check_update_info(url: String) -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent("LTC-Launcher/1.0.0 (contact@ltc.dev)")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let v: serde_json::Value = client
        .get(url.trim())
        .send()
        .await
        .map_err(|e| format!("No se pudo consultar actualizaciones: {}", e))?
        .json()
        .await
        .map_err(|e| format!("JSON de actualización inválido: {}", e))?;

    let version = v
        .get("version")
        .and_then(|x| x.as_str())
        .ok_or("El JSON no trae campo \"version\"")?
        .to_string();
    let notes = v
        .get("notes")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let installer_url = v
        .get("installerUrl")
        .or_else(|| v.get("installer_url"))
        .and_then(|x| x.as_str())
        .ok_or("El JSON no trae campo \"installerUrl\"")?
        .to_string();

    Ok(UpdateInfo {
        version,
        notes,
        installer_url,
        current_version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

/// ¿La versión remota es más nueva que la actual?
#[tauri::command]
pub async fn is_update_newer(remote: String, current: String) -> Result<bool, String> {
    Ok(compare_versions(&remote, &current) == std::cmp::Ordering::Greater)
}

#[tauri::command]
pub async fn get_update_url(state: State<'_, Mutex<InstanceState>>) -> Result<String, String> {
    let state_lock = state.lock().map_err(|e| e.to_string())?;
    Ok(state_lock.config.update_url.clone())
}

#[tauri::command]
pub async fn set_update_url(
    url: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<(), String> {
    let mut state_lock = state.lock().map_err(|e| e.to_string())?;
    state_lock.config.update_url = url.trim().to_string();
    state_lock.config.save();
    Ok(())
}

/// Descarga el instalador a la carpeta temporal (con progreso en vivo).
/// Devuelve la ruta local del instalador.
#[tauri::command]
pub async fn download_update(
    installer_url: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let dir = std::env::temp_dir().join("ltc-updates");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = installer_url
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty() && s.ends_with(".exe"))
        .unwrap_or("LTC-Launcher-Setup.exe");
    let dest = dir.join(filename);
    crate::minecraft::downloader::MinecraftDownloader::stream_download(
        installer_url.trim(),
        &dest,
        Some(&app_handle),
        "Actualización LTC",
    )
    .await?;
    Ok(dest.to_string_lossy().to_string())
}

fn default_installed_exe() -> PathBuf {
    dirs::executable_dir()
        .map(|d| d.join("LTC Launcher").join("LTC Launcher.exe"))
        .unwrap_or_default()
}

/// Ejecuta el instalador en silencio, reabre el launcher ya actualizado
/// y cierra esta instancia. El comando responde de inmediato.
#[tauri::command]
pub async fn apply_update_and_restart(installer_path: String) -> Result<(), String> {
    let path = PathBuf::from(installer_path.trim());
    if !path.is_file() {
        return Err("No se encontró el instalador descargado.".to_string());
    }
    std::thread::spawn(move || {
        let _ = std::process::Command::new(&path).arg("/S").status();
        let target = default_installed_exe();
        if target.is_file() {
            let _ = std::process::Command::new(&target).spawn();
        } else if let Ok(cur) = std::env::current_exe() {
            let _ = std::process::Command::new(&cur).spawn();
        }
        std::process::exit(0);
    });
    Ok(())
}
