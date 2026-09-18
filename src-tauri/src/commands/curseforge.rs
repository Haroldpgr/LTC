use crate::commands::instance::InstanceState;
use crate::minecraft::curseforge::{
    CurseForgeClient, ModrinthClient, ModrinthSearchResponse, ModrinthVersion,
};
use crate::minecraft::launcher::InstanceConfig;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn search_modrinth(
    query: String,
    mc_version: String,
    project_type: String,
    loader: String,
    limit: u32,
) -> Result<ModrinthSearchResponse, String> {
    ModrinthClient::search(&query, &mc_version, &project_type, &loader, limit).await
}

#[tauri::command]
pub async fn get_modrinth_versions(
    project_id: String,
    mc_version: String,
    loader: String,
) -> Result<Vec<ModrinthVersion>, String> {
    ModrinthClient::get_versions(&project_id, &mc_version, &loader).await
}

#[tauri::command]
pub async fn search_curseforge(
    query: String,
    mc_version: String,
    category: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<serde_json::Value, String> {
    let api_key = {
        let state_lock = state.lock().map_err(|e| e.to_string())?;
        state_lock.config.curseforge_api_key.clone()
    };

    if api_key.is_empty() {
        return Err("API key de CurseForge no configurada. Configúrala en el panel admin.".to_string());
    }

    CurseForgeClient::search(&api_key, &query, &mc_version, &category).await
}

#[tauri::command]
pub async fn get_curseforge_files(
    project_id: String,
    mc_version: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<serde_json::Value, String> {
    let api_key = {
        let state_lock = state.lock().map_err(|e| e.to_string())?;
        state_lock.config.curseforge_api_key.clone()
    };

    if api_key.is_empty() {
        return Err("API key de CurseForge no configurada.".to_string());
    }

    CurseForgeClient::get_files(&api_key, &project_id, &mc_version).await
}

#[tauri::command]
pub async fn install_mod_from_url(
    instance_id: String,
    download_url: String,
    filename: String,
    mod_name: String,
    version_number: String,
    icon_url: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<(), String> {
    let (mods_dir, base_dir) = {
        let state_lock = state.lock().map_err(|e| e.to_string())?;
        let _config = InstanceConfig::load(&state_lock.config.instances_dir, &instance_id)
            .ok_or("Instancia no encontrada")?;
        let mods_dir = InstanceConfig::mods_dir(&state_lock.config.instances_dir, &instance_id);
        std::fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;
        (mods_dir, state_lock.config.instances_dir.clone())
    };

    let dest_path = mods_dir.join(&filename);

    crate::minecraft::downloader::MinecraftDownloader::stream_download(
        &download_url,
        &dest_path,
        Some(&app_handle),
        &filename,
    )
    .await?;

    let hash = crate::minecraft::launcher::Launcher::hash_file(&dest_path)?;
    let mod_id = Uuid::new_v4().to_string();

    let mod_info = crate::minecraft::launcher::ModInfo {
        id: mod_id,
        name: mod_name,
        filename: filename.clone(),
        source: "store".to_string(),
        project_id: None,
        file_id: None,
        hash,
        enabled: true,
        version: Some(version_number),
        icon_url,
    };

    {
        let _guard = state.lock().map_err(|e| e.to_string())?;
        let mut config = InstanceConfig::load(&base_dir, &instance_id)
            .ok_or("Instancia no encontrada")?;
        config.mods.retain(|m| m.filename != mod_info.filename);
        config.mods.push(mod_info);
        config.save(&base_dir)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn download_file_to_disk(
    download_url: String,
    filename: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let downloads_dir = dirs::download_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join("Downloads"));

    std::fs::create_dir_all(&downloads_dir).map_err(|e| e.to_string())?;
    let dest_path = downloads_dir.join(&filename);

    crate::minecraft::downloader::MinecraftDownloader::stream_download(
        &download_url,
        &dest_path,
        Some(&app_handle),
        &filename,
    )
    .await?;

    Ok(dest_path.to_string_lossy().to_string())
}
