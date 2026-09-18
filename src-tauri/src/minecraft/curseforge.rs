use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthSearchResponse {
    pub hits: Vec<ModrinthMod>,
    pub total_hits: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthMod {
    pub slug: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub downloads: u64,
    pub follows: u64,
    pub icon_url: Option<String>,
    pub project_id: String,
    pub versions: Vec<String>,
    pub categories: Vec<String>,
    pub project_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthVersion {
    pub id: String,
    pub name: String,
    pub version_number: String,
    pub files: Vec<ModrinthFile>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub date_published: String,
    pub downloads: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthFile {
    pub url: String,
    pub filename: String,
    pub size: u64,
    pub hashes: Option<ModrinthHashes>,
    pub primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthHashes {
    pub sha1: Option<String>,
    pub sha512: Option<String>,
}

pub const MODRINTH_API: &str = "https://api.modrinth.com/v2";

pub struct ModrinthClient;

impl ModrinthClient {
    pub async fn search(
        query: &str,
        mc_version: &str,
        project_type: &str,
        loader: &str,
        limit: u32,
    ) -> Result<ModrinthSearchResponse, String> {
        let client = reqwest::Client::new();

        let mut facets = vec![
            format!(r#""versions:{}""#, mc_version),
            format!(r#""project_type:{}""#, project_type),
        ];

        if !loader.is_empty() && loader != "none" && project_type == "mod" {
            facets.push(format!(r#""categories:{}""#, loader));
        }

        let facets_str = format!("[[{}]]", facets.join(","));

        let url = format!(
            "{}/search?query={}&facets={}&limit={}",
            MODRINTH_API,
            urlencoding::encode(query),
            urlencoding::encode(&facets_str),
            limit
        );

        let response = client
            .get(&url)
            .header("User-Agent", "LTC-Launcher/1.0.0 (contact@ltc.dev)")
            .send()
            .await
            .map_err(|e| format!("Error buscando: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Error Modrinth: {}", response.status()));
        }

        response
            .json()
            .await
            .map_err(|e| format!("Error parseando: {}", e))
    }

    pub async fn get_versions(
        project_id: &str,
        mc_version: &str,
        loader: &str,
    ) -> Result<Vec<ModrinthVersion>, String> {
        let client = reqwest::Client::new();

        let game_versions = format!(r#"["{}"]"#, mc_version);
        let loaders = if !loader.is_empty() && loader != "none" {
            format!(r#"["{}"]"#, loader)
        } else {
            "[]".to_string()
        };

        let url = format!(
            "{}/project/{}/version?game_versions={}&loaders={}",
            MODRINTH_API,
            project_id,
            urlencoding::encode(&game_versions),
            urlencoding::encode(&loaders)
        );

        let response = client
            .get(&url)
            .header("User-Agent", "LTC-Launcher/1.0.0 (contact@ltc.dev)")
            .send()
            .await
            .map_err(|e| format!("Error: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Error Modrinth: {}", response.status()));
        }

        response
            .json()
            .await
            .map_err(|e| format!("Error parseando: {}", e))
    }
}

// CurseForge API
pub const CURSEFORGE_API: &str = "https://api.curseforge.com/v1";

pub struct CurseForgeClient;

impl CurseForgeClient {
    fn game_id() -> u32 {
        432 // Minecraft
    }

    fn class_id(category: &str) -> Option<u32> {
        match category {
            "mods" => Some(6),
            "modpacks" => Some(4471),
            "resourcepacks" => Some(12),
            "shaders" => Some(6552),
            _ => Some(6),
        }
    }

    pub async fn search(
        api_key: &str,
        query: &str,
        mc_version: &str,
        category: &str,
    ) -> Result<serde_json::Value, String> {
        let client = reqwest::Client::new();

        let mut url = format!(
            "{}/mods/search?gameId={}&searchFilter={}&gameVersion={}",
            CURSEFORGE_API,
            Self::game_id(),
            urlencoding::encode(query),
            urlencoding::encode(mc_version),
        );

        if let Some(class_id) = Self::class_id(category) {
            url.push_str(&format!("&classId={}", class_id));
        }

        url.push_str("&pageSize=24&sortField=2&sortOrder=desc");

        let response = client
            .get(&url)
            .header("x-api-key", api_key)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("Error CurseForge: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Error CurseForge {}: {}", status, body));
        }

        response
            .json()
            .await
            .map_err(|e| format!("Error parseando CurseForge: {}", e))
    }

    pub async fn get_files(
        api_key: &str,
        project_id: &str,
        mc_version: &str,
    ) -> Result<serde_json::Value, String> {
        let client = reqwest::Client::new();

        let url = format!(
            "{}/mods/{}/files?gameVersion={}&pageSize=20",
            CURSEFORGE_API,
            project_id,
            urlencoding::encode(mc_version),
        );

        let response = client
            .get(&url)
            .header("x-api-key", api_key)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("Error CurseForge: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Error CurseForge: {}", response.status()));
        }

        response
            .json()
            .await
            .map_err(|e| format!("Error parseando: {}", e))
    }
}
