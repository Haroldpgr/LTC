use crate::commands::instance::InstanceState;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

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
