use crate::commands::instance::InstanceState;
use crate::minecraft::launcher::{InstanceConfig, Launcher, ModsSource};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn jar_entries(dir: &Path, prefix: &Path, out: &mut Vec<String>) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                jar_entries(&p, prefix, out);
            } else if p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("jar"))
                .unwrap_or(false)
            {
                let rel = p
                    .strip_prefix(prefix)
                    .unwrap_or(&p)
                    .to_string_lossy()
                    .to_string();
                if let Ok(meta) = entry.metadata() {
                    let mtime = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    out.push(format!("{}|{}|{}", rel, meta.len(), mtime));
                }
            }
        }
    }
}

fn folder_has_jars(folder: &Path) -> bool {
    let mut list = Vec::new();
    jar_entries(folder, folder, &mut list);
    !list.is_empty()
}

fn fingerprint_folder(folder: &Path) -> String {
    let mut list = Vec::new();
    jar_entries(folder, folder, &mut list);
    list.sort();
    let mut hasher = Sha256::new();
    for e in &list {
        hasher.update(e.as_bytes());
        hasher.update(b"\n");
    }
    format!("{:x}", hasher.finalize())
}

fn wipe_mods(mods_dir: &Path) {
    if let Ok(rd) = std::fs::read_dir(mods_dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if name.ends_with(".jar") || name.ends_with(".jar.disabled") {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
}

fn dedupe(name: &str, existing: &[String]) -> String {
    if !existing.iter().any(|n| n == name) {
        return name.to_string();
    }
    let stem = name.strip_suffix(".jar").unwrap_or(name).to_string();
    let mut i = 1;
    loop {
        let cand = format!("{}_{}.jar", stem, i);
        if !existing.iter().any(|n| *n == cand) {
            return cand;
        }
        i += 1;
    }
}

fn copy_jars_from_tree(src: &Path, mods_dir: &Path, config: &mut InstanceConfig) -> Result<usize, String> {
    std::fs::create_dir_all(mods_dir).map_err(|e| e.to_string())?;
    let mut count = 0usize;
    let mut dest_names: Vec<String> = Vec::new();
    let mut stack = vec![src.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for entry in rd.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("jar"))
                    .unwrap_or(false)
                {
                    let raw = p.file_name().unwrap_or_default().to_string_lossy().to_string();
                    let fname = dedupe(&raw, &dest_names);
                    dest_names.push(fname.clone());
                    let dest = mods_dir.join(&fname);
                    std::fs::copy(&p, &dest).map_err(|e| format!("Error copiando {}: {}", fname, e))?;
                    let hash = Launcher::hash_file(&dest)?;
                    config.mods.push(crate::minecraft::launcher::ModInfo {
                        id: uuid::Uuid::new_v4().to_string(),
                        name: fname.strip_suffix(".jar").unwrap_or(&fname).to_string(),
                        filename: fname,
                        source: "local".to_string(),
                        project_id: None,
                        file_id: None,
                        hash,
                        enabled: true,
                        version: None,
                        icon_url: None,
                    });
                    count += 1;
                }
            }
        }
    }
    if count == 0 {
        return Err("No se encontraron archivos .jar en la fuente de mods".to_string());
    }
    Ok(count)
}

fn sniff_archive(path: &Path) -> Result<String, String> {
    let mut f =
        std::fs::File::open(path).map_err(|e| format!("No se pudo abrir el archivo: {}", e))?;
    let mut buf = [0u8; 4];
    let n = f.read(&mut buf).unwrap_or(0);
    if n >= 2 && (&buf[0..2] == b"PK") {
        Ok("zip".to_string())
    } else if n >= 4 && (&buf[0..4] == b"Rar!") {
        Ok("rar".to_string())
    } else {
        Err("El archivo no es un .zip ni un .rar válido".to_string())
    }
}

fn extract_zip(zip_path: &Path, staging: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("No se pudo abrir el ZIP: {}", e))?;
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
        let rel = name.rsplit('/').next().unwrap_or(&name).to_string();
        if rel.is_empty() {
            continue;
        }
        let dest = staging.join(&rel);
        let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn find_extractor() -> Option<PathBuf> {
    const CANDIDATES: [&str; 4] = [
        r"C:\Program Files\7-Zip\7z.exe",
        r"C:\Program Files (x86)\7-Zip\7z.exe",
        r"C:\Program Files\WinRAR\WinRAR.exe",
        r"C:\Program Files\WinRAR\rar.exe",
    ];
    for c in CANDIDATES {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }
    for name in ["7z", "winrar", "rar"] {
        if let Ok(out) = std::process::Command::new("where").arg(name).output() {
            if out.status.success() {
                if let Ok(s) = String::from_utf8(out.stdout) {
                    if let Some(line) = s.lines().next() {
                        let p = PathBuf::from(line.trim());
                        if p.exists() {
                            return Some(p);
                        }
                    }
                }
            }
        }
    }
    None
}

fn extract_rar(rar_path: &Path, staging: &Path) -> Result<(), String> {
    let exe = find_extractor().ok_or(
        "No se encontró 7-Zip ni WinRAR para extraer el .rar. Instala 7-Zip o usa un .zip.".to_string(),
    )?;
    let out_arg = format!("-o{}", staging.to_string_lossy());
    let status = std::process::Command::new(&exe)
        .arg("x")
        .arg("-y")
        .arg("-bso0")
        .arg("-bsp0")
        .arg(&out_arg)
        .arg(rar_path)
        .status()
        .map_err(|e| format!("No se pudo ejecutar {}: {}", exe.to_string_lossy(), e))?;
    if !status.success() {
        return Err("Error al extraer el archivo .rar".to_string());
    }
    Ok(())
}

fn extract_archive(archive: &Path, staging: &Path) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(staging);
    std::fs::create_dir_all(staging).map_err(|e| e.to_string())?;
    match sniff_archive(archive)?.as_str() {
        "zip" => extract_zip(archive, staging)?,
        "rar" => extract_rar(archive, staging)?,
        other => return Err(format!("Formato no soportado: {}", other)),
    }
    Ok(())
}

async fn head_meta(url: &str) -> Option<String> {
    let client = reqwest::Client::new();
    let resp = client.head(url).send().await.ok()?;
    let etag = resp
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let last = resp
        .headers()
        .get(reqwest::header::LAST_MODIFIED)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let len = resp
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if etag.is_empty() && last.is_empty() && len.is_empty() {
        Some("no-meta".to_string())
    } else {
        Some(format!("{}|{}|{}", etag, last, len))
    }
}

async fn download_url(url: &str, dest: &Path) -> Result<(), String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Error descargando {}: {}", url, e))?;
    if !resp.status().is_success() {
        return Err(format!("Error descargando {}: HTTP {}", url, resp.status()));
    }
    let content = resp
        .bytes()
        .await
        .map_err(|e| format!("Error leyendo la descarga: {}", e))?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(dest, &content).map_err(|e| format!("Error guardando archivo: {}", e))
}

async fn resolve_url_archive(
    base: &PathBuf,
    config: &mut InstanceConfig,
) -> Result<PathBuf, String> {
    let source = config
        .mods_source
        .clone()
        .ok_or_else(|| "Sin fuente de mods configurada".to_string())?;
    let inst_dir = InstanceConfig::instance_dir(base, &config.id);
    let cache = inst_dir.join("mods_source_cache");
    let url = source.archive_url.clone();

    if cache.exists() && !source.remote_meta.is_empty() {
        if let Some(meta) = head_meta(&url).await {
            if meta == source.remote_meta {
                return Ok(cache);
            }
        }
    }

    download_url(&url, &cache).await?;
    if let Some(meta) = head_meta(&url).await {
        if let Some(mut src) = config.mods_source.take() {
            src.remote_meta = meta;
            config.mods_source = Some(src);
        }
    }
    Ok(cache)
}

pub(crate) async fn sync_mods_source_internal(base: &PathBuf, instance_id: &str) -> Result<bool, String> {
    let mut config = InstanceConfig::load(base, instance_id).ok_or("Instancia no encontrada")?;
    let Some(source) = config.mods_source.clone() else {
        return Ok(false);
    };
    if source.source_type == ModsSource::TYPE_NONE {
        return Ok(false);
    }

    let mut archive: Option<PathBuf> = None;
    match source.source_type.as_str() {
        ModsSource::TYPE_ARCHIVE if !source.archive_url.is_empty() => {
            archive = Some(resolve_url_archive(base, &mut config).await?);
        }
        ModsSource::TYPE_ARCHIVE => {
            let p = PathBuf::from(&source.archive_path);
            if !p.exists() {
                return Err(format!(
                    "El archivo de mods no existe: {}",
                    source.archive_path
                ));
            }
            archive = Some(p);
        }
        _ => {}
    }

    let fingerprint = match source.source_type.as_str() {
        ModsSource::TYPE_FOLDER => fingerprint_folder(&PathBuf::from(&source.folder_path)),
        ModsSource::TYPE_ARCHIVE => {
            let p = archive.as_ref().ok_or("Archivo de mods no disponible")?;
            Launcher::hash_file(p)?
        }
        _ => String::new(),
    };

    if source.fingerprint == fingerprint {
        return Ok(false);
    }

    let mods_dir = InstanceConfig::mods_dir(base, instance_id);
    std::fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;
    wipe_mods(&mods_dir);
    config.mods.clear();

    if source.source_type == ModsSource::TYPE_FOLDER {
        let folder = PathBuf::from(&source.folder_path);
        if !folder.is_dir() {
            return Err(format!("La carpeta de mods no existe: {}", source.folder_path));
        }
        copy_jars_from_tree(&folder, &mods_dir, &mut config)?;
    } else {
        let ap = archive.ok_or("Archivo de mods no disponible")?;
        let inst_dir = InstanceConfig::instance_dir(base, instance_id);
        let staging = inst_dir.join("mods_staging");
        extract_archive(&ap, &staging)?;
        let result = copy_jars_from_tree(&staging, &mods_dir, &mut config);
        let _ = std::fs::remove_dir_all(&staging);
        result?;
    }

    if let Some(mut src) = config.mods_source.take() {
        src.fingerprint = fingerprint;
        src.synced_at = now_iso();
        config.mods_source = Some(src);
    }
    config.save(base)?;
    Ok(true)
}

#[tauri::command]
pub fn set_mods_source_folder(
    instance_id: String,
    folder_path: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<(), String> {
    let state_lock = state.lock().map_err(|e| e.to_string())?;
    let mut config = InstanceConfig::load(&state_lock.config.instances_dir, &instance_id)
        .ok_or("Instancia no encontrada")?;

    let folder = PathBuf::from(&folder_path);
    if !folder.is_dir() {
        return Err("La carpeta no existe".to_string());
    }
    if !folder_has_jars(&folder) {
        return Err("La carpeta no contiene archivos .jar".to_string());
    }

    config.mods_source = Some(ModsSource::new_folder(folder_path));
    config.save(&state_lock.config.instances_dir)
}

#[tauri::command]
pub fn set_mods_source_archive(
    instance_id: String,
    archive_path: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<(), String> {
    let state_lock = state.lock().map_err(|e| e.to_string())?;
    let mut config = InstanceConfig::load(&state_lock.config.instances_dir, &instance_id)
        .ok_or("Instancia no encontrada")?;

    let file = PathBuf::from(&archive_path);
    if !file.exists() {
        return Err("El archivo no existe".to_string());
    }
    sniff_archive(&file)?;

    config.mods_source = Some(ModsSource::new_archive(archive_path));
    config.save(&state_lock.config.instances_dir)
}

#[tauri::command]
pub fn set_mods_source_url(
    instance_id: String,
    url: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("La URL debe empezar por http:// o https://".to_string());
    }
    let state_lock = state.lock().map_err(|e| e.to_string())?;
    let mut config = InstanceConfig::load(&state_lock.config.instances_dir, &instance_id)
        .ok_or("Instancia no encontrada")?;

    config.mods_source = Some(ModsSource::new_url(url));
    config.save(&state_lock.config.instances_dir)
}

#[tauri::command]
pub fn clear_mods_source(
    instance_id: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<(), String> {
    let state_lock = state.lock().map_err(|e| e.to_string())?;
    let mut config = InstanceConfig::load(&state_lock.config.instances_dir, &instance_id)
        .ok_or("Instancia no encontrada")?;

    config.mods_source = None;
    config.save(&state_lock.config.instances_dir)
}

#[tauri::command]
pub async fn sync_mods_source_now(
    instance_id: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<bool, String> {
    let base = {
        let inst_state = state.lock().map_err(|e| e.to_string())?;
        inst_state.config.instances_dir.clone()
    };
    sync_mods_source_internal(&base, &instance_id).await
}