use crate::config::AppConfig;
use crate::minecraft::downloader::MinecraftDownloader;
use crate::minecraft::launcher::{InstanceConfig, Launcher};
use crate::minecraft::loaders::{ensure_loader_ready, install_loader, resolve_version_info};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

/// Vigila el proceso de Minecraft en segundo plano y avisa al frontend cuando
/// termina, para no dejar el estado "En juego" colgado si el juego crashea.
fn watch_game_process(app_handle: AppHandle, instance_id: String, mut child: std::process::Child) {
    std::thread::spawn(move || {
        let start = std::time::Instant::now();
        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        let early = start.elapsed() < std::time::Duration::from_secs(20);
        let _ = app_handle.emit(
            "game-exited",
            serde_json::json!({
                "instanceId": instance_id,
                "code": code,
                "earlyExit": early && code != 0,
            }),
        );
    });
}

fn runtimes_dir_for(instances_dir: &PathBuf) -> PathBuf {
    instances_dir
        .parent()
        .map(|p| p.join("runtimes"))
        .unwrap_or_else(|| instances_dir.join("runtimes"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceInput {
    pub name: String,
    pub description: String,
    pub icon: String,
    #[serde(rename = "mcVersion")]
    pub mc_version: String,
    #[serde(rename = "modLoader")]
    pub mod_loader: String,
    #[serde(rename = "modLoaderVersion")]
    pub mod_loader_version: String,
    #[serde(rename = "javaVersion")]
    pub java_version: i32,
    #[serde(rename = "ramMin")]
    pub ram_min: String,
    #[serde(rename = "ramMax")]
    pub ram_max: String,
    #[serde(rename = "jvmArgs")]
    pub jvm_args: Vec<String>,
    #[serde(rename = "serverAddress")]
    pub server_address: String,
    #[serde(rename = "serverPort")]
    pub server_port: u16,
    pub mods: Vec<crate::commands::mods_cmd::ModInfoFrontend>,
    #[serde(rename = "isInstalled")]
    pub is_installed: bool,
    #[serde(default, rename = "official")]
    pub official: bool,
}

pub struct InstanceState {
    pub config: AppConfig,
}

fn load_all_instances(config: &AppConfig) -> Vec<InstanceConfig> {
    let mut instances = Vec::new();
    let base = &config.instances_dir;

    if base.exists() {
        if let Ok(entries) = std::fs::read_dir(base) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let id = entry.file_name().to_string_lossy().to_string();
                    if let Some(instance) = InstanceConfig::load(base, &id) {
                        instances.push(instance);
                    }
                }
            }
        }
    }

    instances
}

#[tauri::command]
pub async fn get_instances(
    state: State<'_, Mutex<InstanceState>>,
) -> Result<Vec<InstanceConfig>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(load_all_instances(&state.config))
}

#[tauri::command]
pub async fn create_instance(
    instance: InstanceInput,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let id = format!("instance-{}", Uuid::new_v4().to_string().split('-').next().unwrap_or("0000"));

    let config = InstanceConfig {
        id: id.clone(),
        name: instance.name,
        description: instance.description,
        icon: instance.icon,
        mc_version: instance.mc_version,
        mod_loader: instance.mod_loader,
        mod_loader_version: instance.mod_loader_version,
        java_version: instance.java_version,
        ram_min: instance.ram_min,
        ram_max: instance.ram_max,
        jvm_args: instance.jvm_args,
        server_address: instance.server_address,
        server_port: instance.server_port,
        mods: instance
            .mods
            .into_iter()
            .map(|m| crate::commands::mods_cmd::ModInfoFrontend::to_internal(&m))
            .collect(),
        is_installed: instance.is_installed,
        official: instance.official,
        // Fuente preconfigurada al pack propio de la instancia: lo que
        // publique el admin les llega solo al abrir el launcher y al Jugar.
        mods_source: Some(crate::minecraft::launcher::ModsSource::new_url(
            crate::minecraft::launcher::mods_pack_url_for(&id),
        )),
    };

    let instance_dir = InstanceConfig::instance_dir(&state.config.instances_dir, &id);
    std::fs::create_dir_all(&instance_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(instance_dir.join("mods")).map_err(|e| e.to_string())?;

    config.save(&state.config.instances_dir)
}

/// Actualización parcial: solo se aplican los campos presentes en `updates`.
/// Si cambia MC, loader o versión del loader, se marca como no instalada para
/// forzar la (re)instalación del loader correcto.
#[tauri::command]
pub async fn update_instance(
    id: String,
    updates: serde_json::Value,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;

    let mut config =
        InstanceConfig::load(&state.config.instances_dir, &id).ok_or("Instancia no encontrada")?;

    let old_loader = (
        config.mod_loader.clone(),
        config.mod_loader_version.clone(),
        config.mc_version.clone(),
    );

    if let Some(v) = updates.get("name").and_then(|v| v.as_str()) {
        config.name = v.to_string();
    }
    if let Some(v) = updates.get("description").and_then(|v| v.as_str()) {
        config.description = v.to_string();
    }
    if let Some(v) = updates.get("icon").and_then(|v| v.as_str()) {
        config.icon = v.to_string();
    }
    if let Some(v) = updates.get("mcVersion").and_then(|v| v.as_str()) {
        config.mc_version = v.to_string();
    }
    if let Some(v) = updates.get("modLoader").and_then(|v| v.as_str()) {
        config.mod_loader = v.to_string();
    }
    if let Some(v) = updates.get("modLoaderVersion").and_then(|v| v.as_str()) {
        config.mod_loader_version = v.to_string();
    }
    if let Some(v) = updates.get("javaVersion").and_then(|v| v.as_i64()) {
        config.java_version = v as i32;
    }
    if let Some(v) = updates.get("ramMin").and_then(|v| v.as_str()) {
        config.ram_min = v.to_string();
    }
    if let Some(v) = updates.get("ramMax").and_then(|v| v.as_str()) {
        config.ram_max = v.to_string();
    }
    if let Some(arr) = updates.get("jvmArgs").and_then(|v| v.as_array()) {
        config.jvm_args = arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }
    if let Some(v) = updates.get("serverAddress").and_then(|v| v.as_str()) {
        config.server_address = v.to_string();
    }
    if let Some(v) = updates.get("serverPort").and_then(|v| v.as_u64()) {
        config.server_port = v as u16;
    }
    if let Some(arr) = updates.get("mods").and_then(|v| v.as_array()) {
        let mut mods = Vec::new();
        for m in arr {
            if let Ok(front) =
                serde_json::from_value::<crate::commands::mods_cmd::ModInfoFrontend>(m.clone())
            {
                mods.push(front.to_internal());
            }
        }
        config.mods = mods;
    }
    if let Some(v) = updates.get("isInstalled").and_then(|v| v.as_bool()) {
        config.is_installed = v;
    }
    if let Some(v) = updates.get("official").and_then(|v| v.as_bool()) {
        config.official = v;
    }

    if config.mod_loader != old_loader.0
        || config.mod_loader_version != old_loader.1
        || config.mc_version != old_loader.2
    {
        config.is_installed = false;
    }

    config.save(&state.config.instances_dir)
}

#[tauri::command]
pub async fn delete_instance(
    id: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let dir = InstanceConfig::instance_dir(&state.config.instances_dir, &id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn launch_instance(
    instance_id: String,
    app_handle: AppHandle,
    state: State<'_, Mutex<InstanceState>>,
    auth_state: State<'_, Mutex<super::auth::AuthState>>,
) -> Result<(), String> {
    // Extract data from state before any await
    let (mut config, instance_dir, runtimes_dir, base_dir) = {
        let inst_state = state.lock().map_err(|e| e.to_string())?;
        let config = InstanceConfig::load(&inst_state.config.instances_dir, &instance_id)
            .ok_or("Instancia no encontrada")?;
        let instance_dir = InstanceConfig::instance_dir(&inst_state.config.instances_dir, &instance_id);
        let runtimes_dir = runtimes_dir_for(&inst_state.config.instances_dir);
        let base_dir = inst_state.config.instances_dir.clone();
        (config, instance_dir, runtimes_dir, base_dir)
    };

    let account = {
        let auth = auth_state.lock().map_err(|e| e.to_string())?;
        auth.account.clone().ok_or("No hay cuenta logueada")?
    };

    if !config.is_installed {
        return Err("La instancia no está instalada".to_string());
    }

    // Si se cambió el loader/versión, instalarlo automáticamente antes de lanzar
    if ensure_loader_ready(
        &config.mod_loader,
        &config.mod_loader_version,
        &config.mc_version,
        config.java_version,
        &instance_dir,
        &base_dir,
        &instance_id,
        &runtimes_dir,
        &app_handle,
    )
    .await?
    {
        config = InstanceConfig::load(&base_dir, &instance_id).ok_or("Instancia no encontrada")?;
    }

    // Descarga Java automáticamente si no existe
    let java_path =
        Launcher::ensure_java(config.java_version, Some(&app_handle), &runtimes_dir).await?;

    // Version info efectiva (Forge usa su propio json, Fabric combina el vanilla)
    let version_info = resolve_version_info(
        &instance_dir,
        &config.mod_loader,
        &config.mod_loader_version,
        &config.mc_version,
    )
    .await?;

    // Skin personalizada dentro del juego (no bloquea si falla)
    let _ = crate::minecraft::skin::ensure_custom_skin(
        &instance_dir,
        &config,
        &account.username,
        account.skin_url.as_deref(),
    )
    .await;

    let mut cmd = Launcher::build_launch_command(
        &instance_dir,
        &config,
        &version_info,
        &account.username,
        &account.uuid,
        account.access_token.as_deref().unwrap_or("0"),
        &java_path,
    );

    let child = cmd
        .spawn()
        .map_err(|e| format!("Error al iniciar Minecraft: {}", e))?;
    watch_game_process(app_handle, instance_id, child);

    Ok(())
}

#[tauri::command]
pub async fn sync_and_launch(
    instance_id: String,
    app_handle: AppHandle,
    state: State<'_, Mutex<InstanceState>>,
    auth_state: State<'_, Mutex<super::auth::AuthState>>,
) -> Result<(), String> {
    // 0. Resync mods source if configured (folder/archive/url)
    let base = {
        let inst_state = state.lock().map_err(|e| e.to_string())?;
        inst_state.config.instances_dir.clone()
    };
    crate::commands::mods_source::sync_mods_source_internal(&base, &instance_id, false).await?;

    // 1. Sync mods: scan disk vs config
    let (mut config, instance_dir) = {
        let inst_state = state.lock().map_err(|e| e.to_string())?;
        let mut config = InstanceConfig::load(&inst_state.config.instances_dir, &instance_id)
            .ok_or("Instancia no encontrada")?;
        let instance_dir = InstanceConfig::instance_dir(&inst_state.config.instances_dir, &instance_id);

        let mods_dir = instance_dir.join("mods");
        let mut disk_mods: Vec<String> = Vec::new();

        if mods_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&mods_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.ends_with(".jar") {
                        disk_mods.push(name.clone());
                        if !config.mods.iter().any(|m| m.filename == name) {
                            let path = entry.path();
                            let hash = Launcher::hash_file(&path).unwrap_or_default();
                            config.mods.push(crate::minecraft::launcher::ModInfo {
                                id: uuid::Uuid::new_v4().to_string(),
                                name: name.strip_suffix(".jar").unwrap_or(&name).to_string(),
                                filename: name,
                                source: "local".to_string(),
                                project_id: None,
                                file_id: None,
                                 hash,
                                 enabled: true,
                                 version: None,
                                 icon_url: None,
                            });
                        }
                    }
                }
            }
        }

        // Remove mods from config that no longer exist on disk
        config.mods.retain(|m| !m.enabled || disk_mods.contains(&m.filename));

        // Handle disabled mods (.jar.disabled)
        let disabled_mods: Vec<String> = if mods_dir.exists() {
            std::fs::read_dir(&mods_dir)
                .ok()
                .map(|entries| {
                    entries.flatten()
                        .filter(|e| e.file_name().to_string_lossy().ends_with(".jar.disabled"))
                        .map(|e| e.file_name().to_string_lossy().to_string().replace(".disabled", ""))
                        .collect()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        for m in &mut config.mods {
            if disabled_mods.contains(&m.filename) {
                m.enabled = false;
            }
        }

        config.save(&inst_state.config.instances_dir)?;
        (config, instance_dir)
    };

    // Servidor pre-registrado en servers.dat (entrada directa + un clic)
    ensure_server_entry(
        &instance_dir,
        &config.name,
        &config.server_address,
        config.server_port,
    );

    // 2. Extract account
    let account = {
        let auth = auth_state.lock().map_err(|e| e.to_string())?;
        auth.account.clone().ok_or("No hay cuenta logueada")?
    };

    if !config.is_installed {
        return Err("La instancia no está instalada".to_string());
    }

    // Si se cambió el loader/versión, instalarlo automáticamente antes de lanzar
    let (runtimes_dir, base_dir) = {
        let inst_state = state.lock().map_err(|e| e.to_string())?;
        (
            runtimes_dir_for(&inst_state.config.instances_dir),
            inst_state.config.instances_dir.clone(),
        )
    };
    if ensure_loader_ready(
        &config.mod_loader,
        &config.mod_loader_version,
        &config.mc_version,
        config.java_version,
        &instance_dir,
        &base_dir,
        &instance_id,
        &runtimes_dir,
        &app_handle,
    )
    .await?
    {
        config = InstanceConfig::load(&base_dir, &instance_id).ok_or("Instancia no encontrada")?;
    }

    // Descarga Java automáticamente si no existe
    let java_path =
        Launcher::ensure_java(config.java_version, Some(&app_handle), &runtimes_dir).await?;

    // Version info efectiva (Forge usa su propio json, Fabric combina el vanilla)
    let version_info = resolve_version_info(
        &instance_dir,
        &config.mod_loader,
        &config.mod_loader_version,
        &config.mc_version,
    )
    .await?;

    // Skin personalizada dentro del juego (no bloquea si falla)
    let _ = crate::minecraft::skin::ensure_custom_skin(
        &instance_dir,
        &config,
        &account.username,
        account.skin_url.as_deref(),
    )
    .await;

    let mut cmd = Launcher::build_launch_command(
        &instance_dir,
        &config,
        &version_info,
        &account.username,
        &account.uuid,
        account.access_token.as_deref().unwrap_or("0"),
        &java_path,
    );

    let child = cmd
        .spawn()
        .map_err(|e| format!("Error al iniciar Minecraft: {}", e))?;
    watch_game_process(app_handle, instance_id, child);

    Ok(())
}

struct ServerEntry {
    name: String,
    ip: String,
    icon: Option<String>,
}

fn nbt_write_str(buf: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    buf.extend_from_slice(&(b.len() as u16).to_be_bytes());
    buf.extend_from_slice(b);
}

fn nbt_write_string(buf: &mut Vec<u8>, name: &str, value: &str) {
    buf.push(8);
    nbt_write_str(buf, name);
    nbt_write_str(buf, value);
}

fn nbt_read_str(data: &[u8], pos: &mut usize) -> Option<String> {
    if *pos + 2 > data.len() {
        return None;
    }
    let len = u16::from_be_bytes([data[*pos], data[*pos + 1]]) as usize;
    *pos += 2;
    if *pos + len > data.len() {
        return None;
    }
    let s = String::from_utf8_lossy(&data[*pos..*pos + len]).to_string();
    *pos += len;
    Some(s)
}

fn nbt_read_i32(data: &[u8], pos: &mut usize) -> Option<i32> {
    if *pos + 4 > data.len() {
        return None;
    }
    let v = i32::from_be_bytes([data[*pos], data[*pos + 1], data[*pos + 2], data[*pos + 3]]);
    *pos += 4;
    Some(v)
}

fn nbt_skip(data: &[u8], pos: &mut usize, tag: u8) -> bool {
    match tag {
        0 => true,
        1 => {
            *pos += 1;
            *pos <= data.len()
        }
        2 => {
            *pos += 2;
            *pos <= data.len()
        }
        3 | 4 => {
            *pos += 4;
            *pos <= data.len()
        }
        5 | 6 => {
            *pos += 8;
            *pos <= data.len()
        }
        7 => match nbt_read_i32(data, pos) {
            Some(len) if len >= 0 => {
                *pos += len as usize;
                *pos <= data.len()
            }
            _ => false,
        },
        8 => nbt_read_str(data, pos).is_some(),
        9 => {
            if *pos + 5 > data.len() {
                return false;
            }
            let et = data[*pos];
            *pos += 1;
            let len = match nbt_read_i32(data, pos) {
                Some(l) if l >= 0 => l as usize,
                _ => return false,
            };
            for _ in 0..len {
                if !nbt_skip(data, pos, et) {
                    return false;
                }
            }
            true
        }
        10 => loop {
            if *pos >= data.len() {
                return false;
            }
            let t = data[*pos];
            *pos += 1;
            if t == 0 {
                return true;
            }
            if nbt_read_str(data, pos).is_none() || !nbt_skip(data, pos, t) {
                return false;
            }
        },
        11 => match nbt_read_i32(data, pos) {
            Some(len) if len >= 0 => {
                *pos += len as usize * 4;
                *pos <= data.len()
            }
            _ => false,
        },
        12 => match nbt_read_i32(data, pos) {
            Some(len) if len >= 0 => {
                *pos += len as usize * 8;
                *pos <= data.len()
            }
            _ => false,
        },
        _ => false,
    }
}

/// Lee las entradas {name, ip, icon} de un servers.dat (NBT sin comprimir).
fn read_servers_dat(path: &PathBuf) -> Vec<ServerEntry> {
    let mut out = Vec::new();
    let data = match std::fs::read(path) {
        Ok(d) => d,
        Err(_) => return out,
    };
    let mut pos = 0usize;
    if pos >= data.len() || data[pos] != 10 {
        return out;
    }
    pos += 1;
    if nbt_read_str(&data, &mut pos).is_none() {
        return out;
    }
    loop {
        if pos >= data.len() {
            break;
        }
        let tag = data[pos];
        pos += 1;
        if tag == 0 {
            break;
        }
        let field = match nbt_read_str(&data, &mut pos) {
            Some(f) => f,
            None => break,
        };
        if tag == 9 && field == "servers" {
            if pos + 5 > data.len() {
                break;
            }
            let et = data[pos];
            pos += 1;
            let len = match nbt_read_i32(&data, &mut pos) {
                Some(l) if l >= 0 => l as usize,
                _ => break,
            };
            if et != 10 {
                for _ in 0..len {
                    if !nbt_skip(&data, &mut pos, et) {
                        break;
                    }
                }
                continue;
            }
            for _ in 0..len {
                let mut name = String::new();
                let mut ip = String::new();
                let mut icon: Option<String> = None;
                loop {
                    if pos >= data.len() {
                        break;
                    }
                    let t = data[pos];
                    pos += 1;
                    if t == 0 {
                        break;
                    }
                    let fname = match nbt_read_str(&data, &mut pos) {
                        Some(f) => f,
                        None => break,
                    };
                    if t == 8 {
                        if let Some(v) = nbt_read_str(&data, &mut pos) {
                            match fname.as_str() {
                                "name" => name = v,
                                "ip" => ip = v,
                                "icon" => icon = Some(v),
                                _ => {}
                            }
                            continue;
                        } else {
                            break;
                        }
                    }
                    if !nbt_skip(&data, &mut pos, t) {
                        break;
                    }
                }
                if !ip.is_empty() {
                    out.push(ServerEntry { name, ip, icon });
                }
            }
        } else if !nbt_skip(&data, &mut pos, tag) {
            break;
        }
    }
    out
}

fn write_servers_dat(path: &PathBuf, entries: &[ServerEntry]) -> Result<(), String> {
    let mut buf: Vec<u8> = Vec::new();
    buf.push(10);
    nbt_write_str(&mut buf, "");
    buf.push(9);
    nbt_write_str(&mut buf, "servers");
    buf.push(10);
    buf.extend_from_slice(&(entries.len() as i32).to_be_bytes());
    for e in entries {
        nbt_write_string(&mut buf, "name", &e.name);
        nbt_write_string(&mut buf, "ip", &e.ip);
        if let Some(icon) = &e.icon {
            nbt_write_string(&mut buf, "icon", icon);
        }
        buf.push(0);
    }
    buf.push(0);
    if path.is_file() {
        let backup = path.with_extension("dat_old");
        let _ = std::fs::copy(path, backup);
    }
    std::fs::write(path, buf).map_err(|e| e.to_string())
}

/// Asegura que el servidor de la instancia exista en servers.dat (fusionando
/// con los que ya haya) para entrada directa y en un clic.
fn ensure_server_entry(instance_dir: &PathBuf, instance_name: &str, address: &str, port: u16) {
    let addr = address.trim();
    if addr.is_empty() {
        return;
    }
    let ip = if port == 25565 {
        addr.to_string()
    } else {
        format!("{}:{}", addr, port)
    };
    let path = instance_dir.join("servers.dat");
    let mut entries = read_servers_dat(&path);
    let name = if instance_name.trim().is_empty() {
        "Servidor LTC".to_string()
    } else {
        instance_name.trim().to_string()
    };
    if let Some(e) = entries.iter_mut().find(|e| e.ip.eq_ignore_ascii_case(&ip)) {
        e.name = name;
    } else {
        entries.insert(
            0,
            ServerEntry {
                name,
                ip,
                icon: None,
            },
        );
    }
    let _ = write_servers_dat(&path, &entries);
}

/// Comprueba si una instancia ya tiene los archivos esenciales descargados
/// (client jar, alguna librería, algún índice de assets y artefactos del loader).
fn looks_installed(
    mod_loader: &str,
    mod_loader_version: &str,
    mc_version: &str,
    instance_dir: &PathBuf,
) -> bool {
    if !instance_dir.join("minecraft.jar").is_file() {
        return false;
    }
    let libs_ok = std::fs::read_dir(instance_dir.join("libraries"))
        .map(|mut d| d.next().is_some())
        .unwrap_or(false);
    if !libs_ok {
        return false;
    }
    let idx_ok = std::fs::read_dir(instance_dir.join("assets").join("indexes"))
        .map(|mut d| d.next().is_some())
        .unwrap_or(false);
    if !idx_ok {
        return false;
    }
    match mod_loader {
        "forge" => {
            let expected = format!(
                "{}-forge-{}",
                mc_version.trim(),
                mod_loader_version.trim()
            );
            instance_dir
                .join("versions")
                .join(&expected)
                .join(format!("{}.json", expected))
                .is_file()
        }
        "fabric" => instance_dir.join("loader.json").is_file(),
        _ => true,
    }
}

#[tauri::command]
pub async fn install_instance(
    instance_id: String,
    app_handle: AppHandle,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<(), String> {
    let (mc_version, mod_loader, mod_loader_version, java_version, instance_dir, runtimes_dir, base_dir) = {
        let state_lock = state.lock().map_err(|e| e.to_string())?;

        let config = InstanceConfig::load(&state_lock.config.instances_dir, &instance_id)
            .ok_or("Instancia no encontrada")?;

        let base_dir = state_lock.config.instances_dir.clone();
        let instance_dir = InstanceConfig::instance_dir(&state_lock.config.instances_dir, &instance_id);
        std::fs::create_dir_all(&instance_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(instance_dir.join("mods")).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(instance_dir.join("assets")).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(instance_dir.join("libraries")).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(instance_dir.join("natives")).map_err(|e| e.to_string())?;

        ensure_server_entry(
            &instance_dir,
            &config.name,
            &config.server_address,
            config.server_port,
        );

        let runtimes_dir = runtimes_dir_for(&state_lock.config.instances_dir);
        (
            config.mc_version,
            config.mod_loader,
            config.mod_loader_version,
            config.java_version,
            instance_dir,
            runtimes_dir,
            base_dir,
        )
    };

    // Fast path: si los archivos (incluido el loader) ya están completos pero el
    // flag se perdió, marcar como instalada sin descargar nada.
    if looks_installed(&mod_loader, &mod_loader_version, &mc_version, &instance_dir) {
        let state_lock = state.lock().map_err(|e| e.to_string())?;
        let mut config = InstanceConfig::load(&state_lock.config.instances_dir, &instance_id)
            .ok_or("Instancia no encontrada")?;
        config.is_installed = true;
        config.save(&state_lock.config.instances_dir)?;
        return Ok(());
    }

    // Download Minecraft client, libraries, and assets (no mutex held)
    MinecraftDownloader::download_minecraft(&mc_version, &instance_dir, Some(&app_handle))
        .await?;

    // Java para el instalador del loader + instalación de Forge/Fabric
    let java_exe = Launcher::ensure_java(java_version, Some(&app_handle), &runtimes_dir).await?;
    install_loader(
        &mod_loader,
        &mod_loader_version,
        &mc_version,
        &instance_dir,
        &base_dir,
        &instance_id,
        &java_exe,
        &app_handle,
    )
    .await?;

    // Mark as installed
    {
        let state_lock = state.lock().map_err(|e| e.to_string())?;
        let mut config = InstanceConfig::load(&state_lock.config.instances_dir, &instance_id)
            .ok_or("Instancia no encontrada")?;
        config.is_installed = true;
        config.save(&state_lock.config.instances_dir)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn servers_dat_roundtrip_and_merge() {
        let dir = std::env::temp_dir().join("ltc-servers-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("servers.dat");
        let entries = vec![
            ServerEntry {
                name: "A".into(),
                ip: "a.test:25565".into(),
                icon: None,
            },
            ServerEntry {
                name: "B".into(),
                ip: "b.test".into(),
                icon: Some("icondata".into()),
            },
        ];
        write_servers_dat(&path, &entries).unwrap();
        let back = read_servers_dat(&path);
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].name, "A");
        assert_eq!(back[0].ip, "a.test:25565");
        assert_eq!(back[1].icon.as_deref(), Some("icondata"));
        ensure_server_entry(&dir, "Nuevo", "c.test", 25566);
        let back2 = read_servers_dat(&path);
        assert_eq!(back2.len(), 3);
        assert_eq!(back2[0].ip, "c.test:25566");
        // actualizar existente conserva icono
        ensure_server_entry(&dir, "B2", "b.test", 25565);
        let back3 = read_servers_dat(&path);
        assert_eq!(back3.len(), 3);
        let b = back3.iter().find(|e| e.ip == "b.test").unwrap();
        assert_eq!(b.name, "B2");
        assert_eq!(b.icon.as_deref(), Some("icondata"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[tauri::command]
pub async fn admin_login(
    password: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<bool, String> {
    let state_lock = state.lock().map_err(|e| e.to_string())?;
    let stored_hash = &state_lock.config.admin_password_hash;

    if stored_hash.is_empty() {
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        let hash = format!("{:x}", hasher.finalize());

        drop(state_lock);

        let mut state_lock = state.lock().map_err(|e| e.to_string())?;
        state_lock.config.admin_password_hash = hash;
        state_lock.config.save();
        return Ok(true);
    }

    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    let hash = format!("{:x}", hasher.finalize());

    Ok(hash == *stored_hash)
}
