use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub instances_dir: PathBuf,
    pub admin_password_hash: String,
    pub curseforge_api_key: String,
    pub auto_update: bool,
    #[serde(default, rename = "updateUrl")]
    pub update_url: String,
    /// Token de GitHub del admin para publicar el pack de mods (no se muestra nunca).
    #[serde(default, rename = "githubToken")]
    pub github_token: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        let data_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("LTC Launcher");
        Self {
            instances_dir: data_dir.join("instances"),
            admin_password_hash: String::new(),
            curseforge_api_key: "$2a$10$8qrneNohy/pV0jJKZVbUuu.kXuDwlRmfhnf4o.7VGEN/bEjXTOPWC".to_string(),
            auto_update: true,
            // URL por defecto: el update.json del último release de GitHub.
            // El admin puede cambiarla desde el panel (Info de update).
            update_url: "https://github.com/Haroldpgr/LTC/releases/latest/download/update.json"
                .to_string(),
            github_token: String::new(),
        }
    }
}

impl AppConfig {
    fn config_path() -> PathBuf {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("LTC Launcher")
            .join("config.json")
    }

    pub fn load() -> Self {
        let path = Self::config_path();
        if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            let config = Self::default();
            config.save();
            config
        }
    }

    pub fn save(&self) {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        if let Ok(json) = serde_json::to_string_pretty(self) {
            std::fs::write(&path, json).ok();
        }
    }
}
