use super::curseforge::ModrinthClient;
use super::downloader::MinecraftDownloader;
use super::launcher::InstanceConfig;
use std::path::PathBuf;

/// Fuerza la skin del jugador DENTRO del juego (cuentas offline y skins
/// personalizadas del SkinStudio).
/// Mecanismo: mod CustomSkinLoader (Forge/Fabric) + skin local en
/// `CustomSkinLoader/LocalSkin/skins/<usuario>.png`, que CSL carga con
/// prioridad sin necesidad de internet ni cuentas premium.
/// Devuelve true si dejó la skin instalada. El llamador ignora los errores
/// para no bloquear nunca el arranque.
pub async fn ensure_custom_skin(
    instance_dir: &PathBuf,
    config: &InstanceConfig,
    username: &str,
    session_skin_url: Option<&str>,
) -> Result<bool, String> {
    if config.mod_loader != "forge" && config.mod_loader != "fabric" {
        return Ok(false); // CSL no existe para vanilla
    }

    // Skin efectiva: la de la sesión, o la guardada (SkinStudio) si no hay.
    let mut skin_url: Option<String> = session_skin_url
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    if skin_url.is_none() {
        skin_url = crate::commands::auth::get_saved_accounts()
            .into_iter()
            .find(|a| a.username.eq_ignore_ascii_case(username))
            .and_then(|a| a.skin_url)
            .filter(|s| !s.is_empty());
    }
    let Some(url) = skin_url else {
        return Ok(false);
    };

    let bytes = load_skin_bytes(&url).await?;

    let mods_dir = instance_dir.join("mods");
    std::fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;
    ensure_csl_jar(&mods_dir, &config.mod_loader, &config.mc_version).await?;

    let skins_dir = instance_dir
        .join("CustomSkinLoader")
        .join("LocalSkin")
        .join("skins");
    std::fs::create_dir_all(&skins_dir).map_err(|e| e.to_string())?;
    std::fs::write(skins_dir.join(format!("{}.png", username)), &bytes)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

fn check_png(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 8 && bytes[0..8] == [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1A, b'\n'] {
        Ok(())
    } else {
        Err("La skin no es un PNG válido.".to_string())
    }
}

async fn load_skin_bytes(url: &str) -> Result<Vec<u8>, String> {
    if let Some(rest) = url.strip_prefix("data:") {
        let comma = rest.find(',').ok_or("Skin en dataURL inválida.")?;
        let decoded = base64::engine::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            rest[comma + 1..].trim(),
        )
        .map_err(|e| format!("No se pudo leer la skin: {}", e))?;
        check_png(&decoded)?;
        Ok(decoded)
    } else {
        let client = reqwest::Client::builder()
            .user_agent("LTC-Launcher")
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|e| e.to_string())?;
        let bytes = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("No se pudo descargar la skin: {}", e))?;
        if !bytes.status().is_success() {
            return Err(format!("La URL de la skin devolvió {}", bytes.status()));
        }
        let data = bytes
            .bytes()
            .await
            .map_err(|e| format!("No se pudo leer la skin: {}", e))?;
        check_png(&data)?;
        Ok(data.to_vec())
    }
}

/// Descarga CustomSkinLoader desde Modrinth si aún no está en mods.
async fn ensure_csl_jar(mods_dir: &PathBuf, loader: &str, mc: &str) -> Result<(), String> {
    if let Ok(rd) = std::fs::read_dir(mods_dir) {
        for entry in rd.flatten() {
            let n = entry.file_name().to_string_lossy().to_lowercase();
            if n.starts_with("customskinloader") && n.ends_with(".jar") {
                return Ok(());
            }
        }
    }

    let hits = ModrinthClient::search("CustomSkinLoader", mc, "mod", loader, 10).await?;
    let proj = hits
        .hits
        .iter()
        .find(|h| h.slug.contains("customskinloader"))
        .or(hits.hits.first())
        .ok_or_else(|| format!("CustomSkinLoader no disponible para {} {}.", loader, mc))?;
    let versions = ModrinthClient::get_versions(&proj.project_id, mc, loader).await?;
    let ver = versions
        .first()
        .ok_or_else(|| format!("Sin archivos de CustomSkinLoader para {} {}.", loader, mc))?;
    let file = ver
        .files
        .iter()
        .find(|f| f.primary)
        .or(ver.files.first())
        .ok_or("El archivo de CustomSkinLoader no trae descargas.")?;
    let dest = mods_dir.join(&file.filename);
    if dest.is_file() {
        return Ok(());
    }
    MinecraftDownloader::stream_download(&file.url, &dest, None, "CustomSkinLoader").await?;
    Ok(())
}
