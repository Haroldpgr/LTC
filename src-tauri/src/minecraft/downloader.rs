use super::manifest::*;
use futures::StreamExt;
use reqwest;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgressEvent {
    #[serde(rename = "fileName")]
    pub file_name: String,
    pub current: u64,
    pub total: u64,
    pub percentage: f64,
    pub speed: u64,
}

pub struct MinecraftDownloader;

fn shared_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("LTC-Launcher/1.0.0 (contact@ltc.dev)")
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .pool_idle_timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(8)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

impl MinecraftDownloader {
    fn emit_progress(
        app_handle: Option<&AppHandle>,
        file_name: &str,
        downloaded: u64,
        total: u64,
        started: Instant,
    ) {
        let elapsed = started.elapsed().as_secs_f64().max(0.001);
        let speed = (downloaded as f64 / elapsed) as u64;
        let percentage = if total > 0 {
            (downloaded as f64 / total as f64) * 100.0
        } else {
            100.0
        };
        if let Some(handle) = app_handle {
            let _ = handle.emit(
                "download-progress",
                DownloadProgressEvent {
                    file_name: file_name.to_string(),
                    current: downloaded,
                    total,
                    percentage,
                    speed,
                },
            );
        }
    }

    pub async fn stream_download(
        url: &str,
        dest: &PathBuf,
        app_handle: Option<&AppHandle>,
        file_name: &str,
    ) -> Result<(), String> {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Error creando directorio: {}", e))?;
        }

        const MAX_ATTEMPTS: u32 = 5;
        let mut last_err = String::new();

        for attempt in 1..=MAX_ATTEMPTS {
            match Self::stream_download_once(url, dest, app_handle, file_name).await {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last_err = e;
                    // Borrar archivo parcial para reintentar limpio
                    let _ = std::fs::remove_file(dest);
                    if attempt < MAX_ATTEMPTS {
                        let backoff_ms = 500 * attempt as u64;
                        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                    }
                }
            }
        }

        Err(format!(
            "Error descargando {} tras {} intentos: {}",
            file_name, MAX_ATTEMPTS, last_err
        ))
    }

    async fn stream_download_once(
        url: &str,
        dest: &PathBuf,
        app_handle: Option<&AppHandle>,
        file_name: &str,
    ) -> Result<(), String> {
        let response = shared_client()
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Error descargando {}: {}", file_name, e))?;

        let status = response.status();
        if !status.is_success() {
            if is_retryable_status(status) {
                return Err(format!("Error temporal descargando {}: HTTP {}", file_name, status));
            }
            return Err(format!("Error descargando {}: HTTP {}", file_name, status));
        }

        let total_size = response.content_length().unwrap_or(0);
        let mut stream = response.bytes_stream();
        let mut out = tokio::fs::File::create(dest)
            .await
            .map_err(|e| format!("Error creando {}: {}", file_name, e))?;

        let started = Instant::now();
        let mut downloaded: u64 = 0;
        let mut last_emit = Instant::now();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Error leyendo {}: {}", file_name, e))?;
            out.write_all(&chunk)
                .await
                .map_err(|e| format!("Error escribiendo {}: {}", file_name, e))?;
            downloaded += chunk.len() as u64;

            if last_emit.elapsed() >= Duration::from_millis(80) {
                Self::emit_progress(app_handle, file_name, downloaded, total_size, started);
                last_emit = Instant::now();
            }
        }

        out.flush()
            .await
            .map_err(|e| format!("Error escribiendo {}: {}", file_name, e))?;
        drop(out);

        Self::emit_progress(app_handle, file_name, downloaded, total_size, started);

        Ok(())
    }

    pub async fn get_version_info(version: &str) -> Result<VersionInfo, String> {
        let client = reqwest::Client::new();

        let manifest: VersionManifest = client
            .get(VERSION_MANIFEST_URL)
            .send()
            .await
            .map_err(|e| format!("Error descargando manifest: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Error parseando manifest: {}", e))?;

        let version_entry = manifest
            .versions
            .iter()
            .find(|v| v.id == version)
            .ok_or(format!("Versión {} no encontrada", version))?;

        let version_info: VersionInfo = client
            .get(&version_entry.url)
            .send()
            .await
            .map_err(|e| format!("Error descargando info de versión: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Error parseando info de versión: {}", e))?;

        Ok(version_info)
    }

    pub async fn download_file(
        url: &str,
        dest: &PathBuf,
        expected_sha1: Option<&str>,
        app_handle: Option<&AppHandle>,
        file_name: &str,
    ) -> Result<(), String> {
        if dest.exists() {
            if let Some(sha1) = expected_sha1 {
                if let Ok(actual) = Self::sha1_file(dest) {
                    if actual == sha1 {
                        return Ok(());
                    }
                }
            } else {
                return Ok(());
            }
        }

        Self::stream_download(url, dest, app_handle, file_name).await?;

        if let Some(sha1) = expected_sha1 {
            let actual = Self::sha1_file(dest)?;
            if actual != sha1 {
                std::fs::remove_file(dest).ok();
                return Err(format!(
                    "Hash SHA1 incorrecto para {}: esperado {}, obtenido {}",
                    file_name, sha1, actual
                ));
            }
        }

        Ok(())
    }

    pub async fn download_minecraft(
        version: &str,
        instance_dir: &PathBuf,
        app_handle: Option<&AppHandle>,
    ) -> Result<VersionInfo, String> {
        let version_info = Self::get_version_info(version).await?;

        // Download client jar
        let client_jar = instance_dir.join("minecraft.jar");
        Self::download_file(
            &version_info.downloads.client.url,
            &client_jar,
            Some(&version_info.downloads.client.sha1),
            app_handle,
            &format!("Minecraft {}.jar", version),
        )
        .await?;

        // Download libraries
        let libs_dir = instance_dir.join("libraries");
        std::fs::create_dir_all(&libs_dir).map_err(|e| e.to_string())?;

        let libraries: Vec<&Library> = version_info
            .libraries
            .iter()
            .filter(|lib| Self::is_library_allowed(lib))
            .collect();

        let total_libs = libraries.len();
        for (i, lib) in libraries.iter().enumerate() {
            if let Some(artifact) = &lib.downloads.artifact {
                let lib_path = libs_dir.join(&artifact.path);
                Self::download_file(
                    &artifact.url,
                    &lib_path,
                    Some(&artifact.sha1),
                    app_handle,
                    &format!("Librería {}/{}", i + 1, total_libs),
                )
                .await?;
            }
        }

        // Download + extract Windows native libraries (DLLs de LWJGL, etc.)
        // Sin esto el juego crashea al instante al no encontrar sus nativas.
        Self::download_natives_info(&libraries, &libs_dir, &instance_dir.join("natives"), app_handle)
            .await?;

        // Download asset index
        let assets_dir = instance_dir.join("assets");
        let indexes_dir = assets_dir.join("indexes");
        std::fs::create_dir_all(&indexes_dir).map_err(|e| e.to_string())?;

        let index_file = indexes_dir.join(format!("{}.json", version_info.assets));
        Self::download_file(
            &version_info.asset_index.url,
            &index_file,
            Some(&version_info.asset_index.sha1),
            app_handle,
            "Asset index",
        )
        .await?;

        // Download asset objects concurrently (batch of 8).
        // Los fallos no abortan todo: se recogen y se reintentan al final en
        // modo secuencial. La instalación es reanudable (los archivos ya
        // descargados se omiten por hash), así que pulsar Instalar de nuevo
        // solo descarga lo que falte.
        let index_content: AssetIndexContent = {
            let content = std::fs::read_to_string(&index_file).map_err(|e| e.to_string())?;
            serde_json::from_str(&content).map_err(|e| e.to_string())?
        };

        let objects_dir = assets_dir.join("objects");
        let total_objects = index_content.objects.len();
        let ah = app_handle.cloned();

        let tasks: Vec<_> = index_content
            .objects
            .iter()
            .enumerate()
            .map(|(i, (_name, obj))| {
                let objects_dir = objects_dir.clone();
                let ah = ah.clone();
                let hash = obj.hash.clone();
                async move {
                    let prefix = hash[..2].to_string();
                    let obj_path = objects_dir.join(&prefix).join(&hash);
                    if obj_path.exists() {
                        return Ok(());
                    }
                    let url = format!("{}/{}/{}", RESOURCES_URL, prefix, hash);
                    Self::download_file(
                        &url,
                        &obj_path,
                        Some(&hash),
                        ah.as_ref(),
                        &format!("Asset {}/{}", i + 1, total_objects),
                    )
                    .await
                    .map_err(|e| (i, hash.clone(), e))
                }
            })
            .collect();

        let mut stream = futures::stream::iter(tasks).buffer_unordered(8);
        let mut failed: Vec<(usize, String)> = Vec::new();
        while let Some(res) = stream.next().await {
            if let Err((i, hash, _e)) = res {
                failed.push((i, hash));
            }
        }

        // Reintento final secuencial de los que fallaron (2 rondas extra)
        for _round in 0..2 {
            if failed.is_empty() {
                break;
            }
            let pending = std::mem::take(&mut failed);
            for (i, hash) in pending {
                let prefix = &hash[..2];
                let obj_path = objects_dir.join(prefix).join(&hash);
                let url = format!("{}/{}/{}", RESOURCES_URL, prefix, hash);
                if Self::download_file(
                    &url,
                    &obj_path,
                    Some(&hash),
                    app_handle,
                    &format!("Asset {}/{} (reintento)", i + 1, total_objects),
                )
                .await
                .is_err()
                {
                    failed.push((i, hash));
                }
            }
        }

        if !failed.is_empty() {
            let sample: Vec<String> = failed
                .iter()
                .take(3)
                .map(|(i, _)| format!("Asset {}/{}", i + 1, total_objects))
                .collect();
            return Err(format!(
                "No se pudieron descargar {} assets ({}...). Revisa tu conexión y pulsa Instalar de nuevo para reanudar donde quedó.",
                failed.len(),
                sample.join(", ")
            ));
        }

        Ok(version_info)
    }

    fn is_library_allowed(lib: &Library) -> bool {
        if let Some(rules) = &lib.rules {
            let mut allowed = false;
            for rule in rules {
                if let Some(os) = &rule.os {
                    if let Some(name) = &os.name {
                        if name == "windows" && rule.action == "allow" {
                            allowed = true;
                        } else if name == "windows" && rule.action == "disallow" {
                            allowed = false;
                        }
                    }
                } else if rule.action == "allow" {
                    allowed = true;
                } else if rule.action == "disallow" {
                    allowed = false;
                }
            }
            allowed
        } else {
            true
        }
    }

    /// Descarga y extrae las nativas de Windows (DLLs) de una lista de librerías.
    /// Reutilizable para el json vanilla y para el json de Forge.
    pub async fn download_natives(
        version_info: &VersionInfo,
        instance_dir: &PathBuf,
        app_handle: Option<&AppHandle>,
    ) -> Result<(), String> {
        let libraries: Vec<&Library> = version_info
            .libraries
            .iter()
            .filter(|lib| Self::is_library_allowed(lib))
            .collect();
        let libs_dir = instance_dir.join("libraries");
        Self::download_natives_info(&libraries, &libs_dir, &instance_dir.join("natives"), app_handle).await
    }

    async fn download_natives_info(
        libraries: &[&Library],
        libs_dir: &PathBuf,
        natives_dir: &PathBuf,
        app_handle: Option<&AppHandle>,
    ) -> Result<(), String> {
        std::fs::create_dir_all(natives_dir).map_err(|e| e.to_string())?;
        for lib in libraries.iter() {
            let classifier_key: Option<String> = lib.natives.as_ref().and_then(|n| {
                n.get("windows")
                    .and_then(|v| v.as_str())
                    .map(|s| s.replace("${arch}", "64"))
            });
            let Some(key) = classifier_key else {
                continue;
            };
            let artifact: Option<Artifact> = lib
                .downloads
                .classifiers
                .as_ref()
                .and_then(|c| c.get(&key))
                .and_then(|v| serde_json::from_value(v.clone()).ok());
            let Some(artifact) = artifact else {
                continue;
            };
            let lib_path = libs_dir.join(&artifact.path);
            Self::download_file(
                &artifact.url,
                &lib_path,
                Some(&artifact.sha1),
                app_handle,
                &format!("Nativa {}", lib.name),
            )
            .await?;
            Self::extract_natives(&lib_path, natives_dir)?;
        }
        Ok(())
    }

    /// Extrae el contenido de un jar de nativas (excepto META-INF/) en natives_dir,
    /// preservando rutas internas.
    fn extract_natives(jar_path: &PathBuf, natives_dir: &PathBuf) -> Result<(), String> {
        let file = std::fs::File::open(jar_path)
            .map_err(|e| format!("Error abriendo nativa {}: {}", jar_path.display(), e))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("ZIP de nativa inválido: {}", e))?;
        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("Error leyendo nativa: {}", e))?;
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().replace('\\', "/");
            if name.starts_with("META-INF/") {
                continue;
            }
            let dest = natives_dir.join(&name);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn sha1_file(path: &PathBuf) -> Result<String, String> {
        use sha1::Digest as Sha1Digest;
        let data = std::fs::read(path).map_err(|e| e.to_string())?;
        let mut hasher = sha1::Sha1::new();
        hasher.update(&data);
        let result = hasher.finalize();
        Ok(format!("{:x}", result))
    }
}
