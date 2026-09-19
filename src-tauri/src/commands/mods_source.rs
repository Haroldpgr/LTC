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
    let mut cmd = std::process::Command::new(&exe);
    cmd.arg("x")
        .arg("-y")
        .arg("-bso0")
        .arg("-bsp0")
        .arg(&out_arg)
        .arg(rar_path);
    Launcher::hide_console(&mut cmd);
    let status = cmd
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

    // Vía rápida: si el servidor informa ETag/fecha/tamaño y no cambió,
    // se reutiliza la caché sin descargar nada.
    if cache.is_file() && !source.remote_meta.is_empty() {
        if let Some(meta) = head_meta(&url).await {
            if meta == source.remote_meta {
                return Ok(cache);
            }
        }
    }

    // Descargar a temporal y comparar por hash: si el pack no cambió
    // (hostings sin HEAD, ETag inestable, etc.) no se toca nada y el
    // arranque sigue siendo rápido y sin borrar mods.
    let tmp = inst_dir.join("mods_source_cache.tmp");
    download_url(&url, &tmp).await?;
    let new_hash = Launcher::hash_file(&tmp)?;
    if cache.is_file() && new_hash == source.fingerprint {
        let _ = std::fs::remove_file(&tmp);
        return Ok(cache);
    }
    if tmp != cache {
        let _ = std::fs::remove_file(&cache);
        std::fs::rename(&tmp, &cache).map_err(|e| e.to_string())?;
    }
    if let Some(meta) = head_meta(&url).await {
        if let Some(mut src) = config.mods_source.take() {
            src.remote_meta = meta;
            config.mods_source = Some(src);
        }
    }
    Ok(cache)
}

/// Sincroniza los mods con la fuente configurada.
/// - `strict = true` (botón "Sincronizar"): los errores se devuelven para
///   mostrarlos en la interfaz.
/// - `strict = false` (al darle a Jugar): si el pack no se puede descargar
///   se juega con el último pack conocido o con los mods locales, sin
///   bloquear el arranque por un fallo de red.
pub(crate) async fn sync_mods_source_internal(
    base: &PathBuf,
    instance_id: &str,
    strict: bool,
) -> Result<bool, String> {
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
            match resolve_url_archive(base, &mut config).await {
                Ok(p) => archive = Some(p),
                Err(e) => {
                    let cache =
                        InstanceConfig::instance_dir(base, &config.id).join("mods_source_cache");
                    if cache.is_file() {
                        // Sin red o pack caído: se juega con el último pack conocido.
                        archive = Some(cache);
                    } else if strict {
                        return Err(e);
                    } else {
                        // Aún sin ningún pack (primera vez sin conexión):
                        // se juega con los mods locales sin bloquear.
                        return Ok(false);
                    }
                }
            }
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
pub fn get_default_mods_url() -> String {
    crate::minecraft::launcher::default_mods_pack_url()
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
    sync_mods_source_internal(&base, &instance_id, true).await
}

/// Guarda el token de GitHub del admin (para publicar el pack de mods).
#[tauri::command]
pub fn set_github_token(
    token: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<(), String> {
    let mut state_lock = state.lock().map_err(|e| e.to_string())?;
    state_lock.config.github_token = token.trim().to_string();
    state_lock.config.save();
    Ok(())
}

/// ¿Hay token configurado? (el token nunca se devuelve al frontend).
#[tauri::command]
pub fn has_github_token(state: State<'_, Mutex<InstanceState>>) -> Result<bool, String> {
    let state_lock = state.lock().map_err(|e| e.to_string())?;
    Ok(!state_lock.config.github_token.trim().is_empty())
}

/// Exporta los mods a un zip con el nombre dado, listo para publicar.
fn export_pack_zip(base: &PathBuf, config: &InstanceConfig, filename: &str) -> Result<PathBuf, String> {
    use std::io::Write;

    let mods_dir = InstanceConfig::mods_dir(base, &config.id);
    let out_dir = InstanceConfig::instance_dir(base, &config.id).join("mods-export");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let dest = out_dir.join(filename);

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
        return Err("La instancia no tiene mods .jar para publicar.".to_string());
    }
    Ok(dest)
}

/// Publica el pack de mods: exporta el zip y lo sube al release de GitHub
/// (creándolo si no existe, reemplazando el asset anterior).
/// Devuelve la URL pública del pack. Después, a los usuarios les llega
/// solo al abrir el launcher o al darle a Jugar.
#[tauri::command]
pub async fn publish_mods_pack(
    instance_id: String,
    state: State<'_, Mutex<InstanceState>>,
) -> Result<String, String> {
    use crate::minecraft::launcher::{MODS_ASSET_NAME, MODS_RELEASE_TAG, MODS_REPO};

    let (base, token) = {
        let state_lock = state.lock().map_err(|e| e.to_string())?;
        (
            state_lock.config.instances_dir.clone(),
            state_lock.config.github_token.clone(),
        )
    };
    if token.trim().is_empty() {
        return Err("Falta el token de GitHub: configúralo en el Panel admin (Pack de mods) para publicar.".to_string());
    }
    let token = token.trim().to_string();

    let mut config =
        InstanceConfig::load(&base, &instance_id).ok_or("Instancia no encontrada")?;
    let zip_path = export_pack_zip(&base, &config, crate::minecraft::launcher::MODS_ASSET_NAME)?;

    let client = reqwest::Client::builder()
        .user_agent("LTC-Launcher")
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let auth = format!("Bearer {}", token);
    let api = format!("https://api.github.com/repos/{}/releases", MODS_REPO);

    // 1. Buscar el release por tag; si no existe, crearlo.
    let tag_url = format!("{}/tags/{}", api, MODS_RELEASE_TAG);
    let resp = client
        .get(&tag_url)
        .header("Authorization", &auth)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub no responde: {}", e))?;
    let release: serde_json::Value = if resp.status() == reqwest::StatusCode::NOT_FOUND {
        let created = client
            .post(&api)
            .header("Authorization", &auth)
            .header("Accept", "application/vnd.github+json")
            .json(&serde_json::json!({
                "tag_name": MODS_RELEASE_TAG,
                "name": "Pack de mods",
                "body": "Pack oficial de mods del servidor. Se actualiza solo en el launcher.",
                "draft": false,
                "prerelease": false,
            }))
            .send()
            .await
            .map_err(|e| format!("No se pudo crear el release: {}", e))?;
        let status = created.status();
        let body: serde_json::Value = created.json().await.unwrap_or_default();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err("Token inválido o sin permisos: necesita acceso de escritura al repo (scope repo o Contents: read+write).".to_string());
        }
        if !status.is_success() {
            return Err(format!(
                "GitHub rechazó crear el release ({}): {}",
                status,
                body.get("message").and_then(|m| m.as_str()).unwrap_or("")
            ));
        }
        body
    } else if resp.status() == reqwest::StatusCode::UNAUTHORIZED
        || resp.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err("Token inválido o sin permisos: necesita acceso de escritura al repo (scope repo o Contents: read+write).".to_string());
    } else {
        resp.json()
            .await
            .map_err(|e| format!("Respuesta inesperada de GitHub: {}", e))?
    };

    let upload_tpl = release
        .get("upload_url")
        .and_then(|u| u.as_str())
        .ok_or("GitHub no devolvió URL de subida.")?
        .to_string();

    // 2. Borrar el asset anterior con el mismo nombre (si existe).
    if let Some(assets) = release.get("assets").and_then(|a| a.as_array()) {
        for a in assets {
            let name = a.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let id = a.get("id").and_then(|i| i.as_u64()).unwrap_or(0);
            if name == MODS_ASSET_NAME && id != 0 {
                let del_url = format!("https://api.github.com/repos/{}/releases/assets/{}", MODS_REPO, id);
                let _ = client
                    .delete(&del_url)
                    .header("Authorization", &auth)
                    .header("Accept", "application/vnd.github+json")
                    .send()
                    .await;
            }
        }
    }

    // 3. Subir el zip (stream desde disco + longitud explícita).
    let upload_url = upload_tpl.replace("{?name,label}", &format!("?name={}", MODS_ASSET_NAME));
    let meta = std::fs::metadata(&zip_path).map_err(|e| e.to_string())?;
    let file = tokio::fs::File::open(&zip_path)
        .await
        .map_err(|e| e.to_string())?;
    let up_resp = client
        .post(&upload_url)
        .header("Authorization", &auth)
        .header("Accept", "application/vnd.github+json")
        .header("Content-Type", "application/zip")
        .header("Content-Length", meta.len())
        .body(reqwest::Body::from(file))
        .send()
        .await
        .map_err(|e| format!("Falló la subida: {}", e))?;
    let up_status = up_resp.status();
    let up_body: serde_json::Value = up_resp.json().await.unwrap_or_default();
    if !up_status.is_success() {
        return Err(format!(
            "GitHub rechazó el archivo ({}): {}",
            up_status,
            up_body.get("message").and_then(|m| m.as_str()).unwrap_or("")
        ));
    }
    let public_url = up_body
        .get("browser_download_url")
        .and_then(|u| u.as_str())
        .unwrap_or(&crate::minecraft::launcher::default_mods_pack_url())
        .to_string();

    // 4. Dejar la instancia del admin al día para no re-sincronizarla.
    let hash = Launcher::hash_file(&zip_path)?;
    if let Some(mut src) = config.mods_source.take() {
        src.fingerprint = hash;
        src.synced_at = chrono::Utc::now().to_rfc3339();
        config.mods_source = Some(src);
        config.save(&base)?;
    }

    Ok(public_url)
}

// ---------------------------------------------------------------------------
// Catálogo oficial: las instancias del admin aparecen solas en los launchers
// de los usuarios (GitHub hace de "base de datos", sin servidor propio).
// ---------------------------------------------------------------------------

fn gh_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("LTC-Launcher")
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())
}

fn token_or_err(token: &str) -> Result<String, String> {
    let t = token.trim();
    if t.is_empty() {
        return Err("Falta el token de GitHub: configúralo en el Panel admin (Token de GitHub) para publicar.".to_string());
    }
    Ok(t.to_string())
}

fn token_bad() -> String {
    "Token inválido o sin permisos: necesita acceso de escritura al repo (scope repo o Contents: read+write).".to_string()
}

/// GET del release por tag (None si no existe).
async fn gh_get_release(
    client: &reqwest::Client,
    auth: &str,
) -> Result<Option<serde_json::Value>, String> {
    use crate::minecraft::launcher::{MODS_RELEASE_TAG, MODS_REPO};
    let url = format!(
        "https://api.github.com/repos/{}/releases/tags/{}",
        MODS_REPO, MODS_RELEASE_TAG
    );
    let resp = client
        .get(&url)
        .header("Authorization", auth)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub no responde: {}", e))?;
    match resp.status() {
        reqwest::StatusCode::NOT_FOUND => Ok(None),
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => Err(token_bad()),
        s if s.is_success() => resp
            .json()
            .await
            .map_err(|e| format!("Respuesta inesperada de GitHub: {}", e))
            .map(Some),
        s => Err(format!("GitHub devolvió {}", s)),
    }
}

/// GET o creación del release del contenido oficial.
async fn gh_get_or_create_release(
    client: &reqwest::Client,
    auth: &str,
) -> Result<serde_json::Value, String> {
    use crate::minecraft::launcher::{MODS_RELEASE_TAG, MODS_REPO};
    if let Some(rel) = gh_get_release(client, auth).await? {
        return Ok(rel);
    }
    let api = format!("https://api.github.com/repos/{}/releases", MODS_REPO);
    let created = client
        .post(&api)
        .header("Authorization", auth)
        .header("Accept", "application/vnd.github+json")
        .json(&serde_json::json!({
            "tag_name": MODS_RELEASE_TAG,
            "name": "Contenido oficial LTC",
            "body": "Packs de mods y catálogo de instancias del servidor. Se actualiza solo en el launcher.",
            "draft": false,
            "prerelease": false,
        }))
        .send()
        .await
        .map_err(|e| format!("No se pudo crear el release: {}", e))?;
    let status = created.status();
    let body: serde_json::Value = created.json().await.unwrap_or_default();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(token_bad());
    }
    if !status.is_success() {
        return Err(format!(
            "GitHub rechazó crear el release ({}): {}",
            status,
            body.get("message").and_then(|m| m.as_str()).unwrap_or("")
        ));
    }
    Ok(body)
}

async fn gh_delete_asset(
    client: &reqwest::Client,
    auth: &str,
    release: &serde_json::Value,
    name: &str,
) {
    use crate::minecraft::launcher::MODS_REPO;
    if let Some(assets) = release.get("assets").and_then(|a| a.as_array()) {
        for a in assets {
            let aname = a.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let id = a.get("id").and_then(|i| i.as_u64()).unwrap_or(0);
            if aname == name && id != 0 {
                let del_url = format!(
                    "https://api.github.com/repos/{}/releases/assets/{}",
                    MODS_REPO, id
                );
                let _ = client
                    .delete(&del_url)
                    .header("Authorization", auth)
                    .header("Accept", "application/vnd.github+json")
                    .send()
                    .await;
            }
        }
    }
}

/// Sube un archivo local como asset (reemplazando el anterior del mismo
/// nombre). Devuelve la URL pública de descarga.
async fn gh_upload_file(
    client: &reqwest::Client,
    auth: &str,
    release: &serde_json::Value,
    name: &str,
    path: &Path,
    content_type: &str,
) -> Result<String, String> {
    gh_delete_asset(client, auth, release, name).await;
    let upload_tpl = release
        .get("upload_url")
        .and_then(|u| u.as_str())
        .ok_or("GitHub no devolvió URL de subida.")?
        .to_string();
    let upload_url = upload_tpl.replace("{?name,label}", &format!("?name={}", name));
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| e.to_string())?;
    let up_resp = client
        .post(&upload_url)
        .header("Authorization", auth)
        .header("Accept", "application/vnd.github+json")
        .header("Content-Type", content_type)
        .header("Content-Length", meta.len())
        .body(reqwest::Body::from(file))
        .send()
        .await
        .map_err(|e| format!("Falló la subida de {}: {}", name, e))?;
    let up_status = up_resp.status();
    let up_body: serde_json::Value = up_resp.json().await.unwrap_or_default();
    if !up_status.is_success() {
        return Err(format!(
            "GitHub rechazó {} ({}): {}",
            name,
            up_status,
            up_body.get("message").and_then(|m| m.as_str()).unwrap_or("")
        ));
    }
    Ok(up_body
        .get("browser_download_url")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string())
}

fn list_local_instances(base: &PathBuf) -> Vec<InstanceConfig> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(base) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let id = entry.file_name().to_string_lossy().to_string();
                if let Some(cfg) = InstanceConfig::load(base, &id) {
                    out.push(cfg);
                }
            }
        }
    }
    out
}

/// Publica el contenido oficial: por cada instancia marcada como Oficial
/// sube su pack de mods, y después sube el catalog.json con todas.
/// Lo que publiques aquí les aparece solo a los usuarios al abrir el launcher.
#[tauri::command]
pub async fn publish_catalog(
    state: State<'_, Mutex<InstanceState>>,
) -> Result<String, String> {
    use crate::minecraft::launcher::{CATALOG_ASSET_NAME, mods_pack_url_for};

    let (base, token) = {
        let state_lock = state.lock().map_err(|e| e.to_string())?;
        (
            state_lock.config.instances_dir.clone(),
            state_lock.config.github_token.clone(),
        )
    };
    let token = token_or_err(&token)?;

    let mut officials: Vec<InstanceConfig> = list_local_instances(&base)
        .into_iter()
        .filter(|c| c.official)
        .collect();
    if officials.is_empty() {
        return Err("Marca al menos una instancia como Oficial para publicar.".to_string());
    }

    let client = gh_client()?;
    let auth = format!("Bearer {}", token);
    let mut release = gh_get_or_create_release(&client, &auth).await?;

    let mut packs = 0u32;
    for cfg in officials.iter_mut() {
        let pack_name = format!("mods-{}.zip", cfg.id);
        match export_pack_zip(&base, cfg, &pack_name) {
            Ok(zip_path) => {
                gh_upload_file(&client, &auth, &release, &pack_name, &zip_path, "application/zip")
                    .await?;
                release = gh_get_release(&client, &auth)
                    .await?
                    .ok_or("El release desapareció a mitad de la publicación.")?;
                let hash = Launcher::hash_file(&zip_path)?;
                if let Some(mut src) = cfg.mods_source.take() {
                    src.fingerprint = hash;
                    src.synced_at = now_iso();
                    cfg.mods_source = Some(src);
                }
                packs += 1;
            }
            Err(_) => {
                // Sin mods .jar: se publica la instancia sin pack.
            }
        }
        // Fuente fijada al pack propio de la instancia.
        let url = mods_pack_url_for(&cfg.id);
        let mut src = cfg
            .mods_source
            .clone()
            .unwrap_or_else(|| ModsSource::new_url(url.clone()));
        src.source_type = ModsSource::TYPE_ARCHIVE.to_string();
        src.archive_url = url;
        cfg.mods_source = Some(src);
        cfg.save(&base)?;
    }

    // Catálogo con las oficiales recién guardadas.
    let fresh: Vec<InstanceConfig> = list_local_instances(&base)
        .into_iter()
        .filter(|c| c.official)
        .collect();
    let catalog = serde_json::json!({
        "updatedAt": now_iso(),
        "instances": fresh,
    });
    let cat_dir = std::env::temp_dir().join("ltc-catalog");
    std::fs::create_dir_all(&cat_dir).map_err(|e| e.to_string())?;
    let cat_path = cat_dir.join(CATALOG_ASSET_NAME);
    std::fs::write(
        &cat_path,
        serde_json::to_string_pretty(&catalog).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    gh_upload_file(
        &client,
        &auth,
        &release,
        CATALOG_ASSET_NAME,
        &cat_path,
        "application/json",
    )
    .await?;

    Ok(format!(
        "Publicado: {} instancias oficiales y {} packs de mods. Ya les sale solo a todos.",
        fresh.len(),
        packs
    ))
}

/// Sincroniza el catálogo oficial: crea o actualiza las instancias
/// oficiales en este PC. Se ejecuta solo al abrir el launcher.
/// Devuelve cuántas instancias cambiaron.
#[tauri::command]
pub async fn sync_catalog(state: State<'_, Mutex<InstanceState>>) -> Result<usize, String> {
    let base = {
        let inst_state = state.lock().map_err(|e| e.to_string())?;
        inst_state.config.instances_dir.clone()
    };
    let url = crate::minecraft::launcher::default_catalog_url();
    let client = reqwest::Client::builder()
        .user_agent("LTC-Launcher")
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar el catálogo: {}", e))?;
    if !resp.status().is_success() {
        return Err("Aún no hay catálogo publicado por el admin.".to_string());
    }
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Catálogo inválido: {}", e))?;
    let items = v
        .get("instances")
        .and_then(|i| i.as_array())
        .ok_or("Catálogo inválido: sin instancias.")?;

    let mut changed = 0usize;
    let mut seen: Vec<String> = Vec::new();
    for item in items {
        let mut remote: InstanceConfig = serde_json::from_value(item.clone())
            .map_err(|e| format!("Instancia inválida en el catálogo: {}", e))?;
        remote.official = true;
        seen.push(remote.id.clone());
        match InstanceConfig::load(&base, &remote.id) {
            Some(mut local) => {
                let needs_reinstall = local.mc_version != remote.mc_version
                    || local.mod_loader != remote.mod_loader
                    || local.mod_loader_version != remote.mod_loader_version
                    || local.java_version != remote.java_version;
                // Se preservan los ajustes de rendimiento y el estado local.
                let keep_ram_min = local.ram_min.clone();
                let keep_ram_max = local.ram_max.clone();
                let keep_jvm = local.jvm_args.clone();
                let was_installed = local.is_installed;
                let before = serde_json::to_value(&local).unwrap_or_default();
                local = remote;
                local.ram_min = keep_ram_min;
                local.ram_max = keep_ram_max;
                local.jvm_args = keep_jvm;
                local.is_installed = if needs_reinstall { false } else { was_installed };
                if serde_json::to_value(&local).unwrap_or_default() != before {
                    local.save(&base)?;
                    changed += 1;
                }
            }
            None => {
                remote.is_installed = false;
                remote.save(&base)?;
                changed += 1;
            }
        }
    }

    // Oficiales que el admin retiró: se desmarcan pero se conservan los archivos.
    for mut local in list_local_instances(&base) {
        if local.official && !seen.contains(&local.id) {
            local.official = false;
            local.save(&base)?;
            changed += 1;
        }
    }

    Ok(changed)
}