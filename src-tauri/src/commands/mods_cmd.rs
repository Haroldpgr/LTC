use crate::commands::instance::InstanceState;
use crate::minecraft::launcher::{InstanceConfig, Launcher};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModInfoFrontend {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub source: String,
    #[serde(rename = "projectId")]
    pub project_id: Option<u64>,
    #[serde(rename = "fileId")]
    pub file_id: Option<u64>,
    pub hash: String,
    pub enabled: bool,
    pub version: Option<String>,
    #[serde(default, rename = "iconUrl")]
    pub icon_url: Option<String>,
}

impl ModInfoFrontend {
    pub fn to_internal(&self) -> crate::minecraft::launcher::ModInfo {
        crate::minecraft::launcher::ModInfo {
            id: self.id.clone(),
            name: self.name.clone(),
            filename: self.filename.clone(),
            source: self.source.clone(),
            project_id: self.project_id,
            file_id: self.file_id,
            hash: self.hash.clone(),
            enabled: self.enabled,
            version: self.version.clone(),
            icon_url: self.icon_url.clone(),
        }
    }

    #[allow(dead_code)]
    pub fn from_internal(m: &crate::minecraft::launcher::ModInfo) -> Self {
        Self {
            id: m.id.clone(),
            name: m.name.clone(),
            filename: m.filename.clone(),
            source: m.source.clone(),
            project_id: m.project_id,
            file_id: m.file_id,
            hash: m.hash.clone(),
            enabled: m.enabled,
            version: m.version.clone(),
            icon_url: m.icon_url.clone(),
        }
    }
}

#[tauri::command]
pub async fn add_mod_local(
    instance_id: String,
    file_path: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<(), String> {
    let state_lock = state.lock().map_err(|e| e.to_string())?;

    let mut config = InstanceConfig::load(&state_lock.config.instances_dir, &instance_id)
        .ok_or("Instancia no encontrada")?;

    let source_path = PathBuf::from(&file_path);
    if !source_path.exists() {
        return Err("Archivo no encontrado".to_string());
    }

    let filename = source_path
        .file_name()
        .ok_or("Nombre de archivo inválido")?
        .to_string_lossy()
        .to_string();

    let mods_dir = InstanceConfig::mods_dir(&state_lock.config.instances_dir, &instance_id);
    std::fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;

    let dest_path = mods_dir.join(&filename);
    std::fs::copy(&source_path, &dest_path).map_err(|e| format!("Error copiando mod: {}", e))?;

    let hash = Launcher::hash_file(&dest_path)?;
    let mod_id = Uuid::new_v4().to_string();
    let mod_name = filename
        .strip_suffix(".jar")
        .unwrap_or(&filename)
        .to_string();

    let mod_info = crate::minecraft::launcher::ModInfo {
        id: mod_id,
        name: mod_name,
        filename: filename.clone(),
        source: "local".to_string(),
        project_id: None,
        file_id: None,
        hash,
        enabled: true,
        version: None,
        icon_url: None,
    };

    config.mods.retain(|m| m.filename != filename);
    config.mods.push(mod_info);
    config.save(&state_lock.config.instances_dir)
}

/// Limpia un nombre de archivo .jar para usarlo como búsqueda (quita versión, loader, etc.)
fn clean_mod_query(filename: &str) -> Option<String> {
    let mut name = filename.to_string();
    loop {
        let mut changed = false;
        for ext in [".jar", ".disabled", ".zip"] {
            if let Some(s) = name.strip_suffix(ext) {
                name = s.to_string();
                changed = true;
                break;
            }
        }
        if !changed {
            break;
        }
    }

    let stopwords = [
        "fabric", "forge", "neoforge", "neoforged", "quilt", "mc", "minecraft", "mod",
        "mods", "universal", "all", "api", "lib", "library", "release", "final",
        "hotfix", "beta", "alpha", "common",
    ];

    let mut words: Vec<String> = Vec::new();
    for token in name.split(|c: char| c == '-' || c == '_' || c == '+' || c == ' ' || c == '.') {
        let t = token.trim().to_lowercase();
        if t.len() < 2 || stopwords.contains(&t.as_str()) {
            continue;
        }
        let looks_version = t.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
            || (t.starts_with('v') && t.chars().nth(1).map(|c| c.is_ascii_digit()).unwrap_or(false))
            || (t.contains('.') && t.chars().any(|c| c.is_ascii_digit()));
        if looks_version {
            continue;
        }
        words.push(t);
        if words.len() >= 3 {
            break;
        }
    }

    if words.is_empty() {
        return None;
    }
    Some(words.join(" "))
}

/// Busca en Modrinth los mods locales sin icono y guarda su icon_url en la instancia.
/// Devuelve cuántos iconos se encontraron.
#[tauri::command]
pub async fn resolve_mod_icons(
    instance_id: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<u32, String> {
    let (base_dir, mc_version, loader) = {
        let state_lock = state.lock().map_err(|e| e.to_string())?;
        let config = InstanceConfig::load(&state_lock.config.instances_dir, &instance_id)
            .ok_or("Instancia no encontrada")?;
        (
            state_lock.config.instances_dir.clone(),
            config.mc_version.clone(),
            config.mod_loader.clone(),
        )
    };

    let mut config =
        InstanceConfig::load(&base_dir, &instance_id).ok_or("Instancia no encontrada")?;
    let mut resolved: u32 = 0;

    for m in config
        .mods
        .iter_mut()
        .filter(|m| m.icon_url.as_ref().map(|u| u.is_empty()).unwrap_or(true))
    {
        let Some(query) = clean_mod_query(&m.filename) else {
            continue;
        };
        let first = query.split_whitespace().next().unwrap_or("").to_string();

        // Intento con el loader de la instancia y luego sin filtro de loader
        let loaders = [loader.as_str(), "none"];
        for l in loaders {
            match crate::minecraft::curseforge::ModrinthClient::search(&query, &mc_version, "mod", l, 5).await
            {
                Ok(res) => {
                    let mut pick: Option<&crate::minecraft::curseforge::ModrinthMod> = None;
                    for hit in &res.hits {
                        let has_icon = hit.icon_url.as_ref().map(|u| !u.is_empty()).unwrap_or(false);
                        if has_icon
                            && (hit.slug.to_lowercase().contains(&first)
                                || hit.title.to_lowercase().contains(&first))
                        {
                            pick = Some(hit);
                            break;
                        }
                    }
                    if pick.is_none() {
                        pick = res
                            .hits
                            .iter()
                            .find(|h| h.icon_url.as_ref().map(|u| !u.is_empty()).unwrap_or(false));
                    }
                    if let Some(hit) = pick {
                        m.icon_url = hit.icon_url.clone();
                        resolved += 1;
                        break;
                    }
                }
                Err(_) => continue,
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    config.save(&base_dir)?;
    Ok(resolved)
}

/// Exporta los mods .jar activos de la instancia a un zip para compartir.
/// Devuelve la ruta del archivo generado.
#[tauri::command]
pub async fn export_mods_archive(
    instance_id: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<String, String> {
    use std::io::Write;

    let state_lock = state.lock().map_err(|e| e.to_string())?;
    let config = InstanceConfig::load(&state_lock.config.instances_dir, &instance_id)
        .ok_or("Instancia no encontrada")?;
    let mods_dir = InstanceConfig::mods_dir(&state_lock.config.instances_dir, &instance_id);
    let out_dir =
        InstanceConfig::instance_dir(&state_lock.config.instances_dir, &instance_id)
            .join("mods-export");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let safe_name: String = config
        .name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let dest = out_dir.join(format!("{}-mods-{}.zip", safe_name, stamp));

    let file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut count = 0u32;
    if let Ok(entries) = std::fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if !name.ends_with(".jar") {
                continue;
            }
            let data = std::fs::read(&p).map_err(|e| e.to_string())?;
            zip.start_file(&name, options)
                .map_err(|e| e.to_string())?;
            zip.write_all(&data).map_err(|e| e.to_string())?;
            count += 1;
        }
    }
    zip.finish().map_err(|e| e.to_string())?;

    if count == 0 {
        let _ = std::fs::remove_file(&dest);
        return Err("La instancia no tiene mods .jar para exportar.".to_string());
    }
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn remove_mod(
    instance_id: String,
    mod_id: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<(), String> {
    let state_lock = state.lock().map_err(|e| e.to_string())?;

    let mut config = InstanceConfig::load(&state_lock.config.instances_dir, &instance_id)
        .ok_or("Instancia no encontrada")?;

    if let Some(mod_info) = config.mods.iter().find(|m| m.id == mod_id) {
        let mod_path = InstanceConfig::mods_dir(&state_lock.config.instances_dir, &instance_id)
            .join(&mod_info.filename);
        if mod_path.exists() {
            std::fs::remove_file(&mod_path).ok();
        }
    }

    config.mods.retain(|m| m.id != mod_id);
    config.save(&state_lock.config.instances_dir)
}

#[tauri::command]
pub async fn toggle_mod(
    instance_id: String,
    mod_id: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<(), String> {
    let state_lock = state.lock().map_err(|e| e.to_string())?;

    let mut config = InstanceConfig::load(&state_lock.config.instances_dir, &instance_id)
        .ok_or("Instancia no encontrada")?;

    if let Some(mod_info) = config.mods.iter_mut().find(|m| m.id == mod_id) {
        mod_info.enabled = !mod_info.enabled;

        let mods_dir = InstanceConfig::mods_dir(&state_lock.config.instances_dir, &instance_id);
        let mod_path = mods_dir.join(&mod_info.filename);
        let disabled_path = mods_dir.join(format!("{}.disabled", mod_info.filename));

        if mod_info.enabled {
            if disabled_path.exists() {
                std::fs::rename(&disabled_path, &mod_path).map_err(|e| e.to_string())?;
            }
        } else if mod_path.exists() {
            std::fs::rename(&mod_path, &disabled_path).map_err(|e| e.to_string())?;
        }
    }

    config.save(&state_lock.config.instances_dir)
}
