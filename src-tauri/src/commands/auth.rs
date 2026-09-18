use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_shell::ShellExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    #[serde(rename = "type")]
    pub account_type: String,
    pub username: String,
    pub uuid: String,
    #[serde(rename = "accessToken")]
    pub access_token: Option<String>,
    #[serde(rename = "skinUrl")]
    pub skin_url: Option<String>,
    #[serde(rename = "isLoggedIn")]
    pub is_logged_in: bool,
    #[serde(default, rename = "refreshToken", skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
}

// App de Azure del usuario (LTC): flujo Authorization Code + localhost.
const MS_CLIENT_ID: &str = "116308a7-06ac-4420-b26d-1ee6f933165e";
const MS_REDIRECT_URI: &str = "http://localhost:1653";
const MS_SCOPE: &str = "XboxLive.SignIn XboxLive.offline_access";

fn ms_http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("LTC-Launcher/1.0.0 (contact@ltc.dev)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Espera el callback OAuth en http://localhost:1653/?code=... y devuelve el code.
async fn wait_for_ms_code() -> Result<String, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:1653")
        .await
        .map_err(|e| format!("No se pudo abrir el puerto 1653 para el login (¿otra app lo usa?): {}", e))?;

    let (mut socket, _) = tokio::time::timeout(std::time::Duration::from_secs(300), listener.accept())
        .await
        .map_err(|_| "Se agotó el tiempo de espera: completa el login en el navegador e inténtalo de nuevo.".to_string())
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Error aceptando conexión local: {}", e))?;

    let mut buf = vec![0u8; 0];
    let mut chunk = [0u8; 1024];
    loop {
        let n = tokio::time::timeout(std::time::Duration::from_secs(30), socket.read(&mut chunk))
            .await
            .map_err(|_| "El navegador no respondió a tiempo.".to_string())
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("Error leyendo respuesta local: {}", e))?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > 16384 {
            break;
        }
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    let request = String::from_utf8_lossy(&buf);
    let first_line = request.lines().next().unwrap_or("");
    let path = first_line.split_whitespace().nth(1).unwrap_or("");

    let body = "<html><body style=\"background:#0f172a;color:#fff;font-family:sans-serif;text-align:center;padding-top:60px\"><h2>¡Listo! ✅</h2><p>Ya puedes cerrar esta ventana y volver al launcher.</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = socket.write_all(response.as_bytes()).await;
    let _ = socket.flush().await;

    // ?code=... o ?error=...
    let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut code: Option<String> = None;
    let mut err: Option<String> = None;
    let mut err_desc: Option<String> = None;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            match k {
                "code" => code = Some(v.to_string()),
                "error" => err = Some(v.to_string()),
                "error_description" => {
                    err_desc = Some(
                        urlencoding::decode(v)
                            .map(|s| s.into_owned())
                            .unwrap_or_else(|_| v.to_string()),
                    )
                }
                _ => {}
            }
        }
    }
    if let Some(c) = code {
        Ok(c)
    } else if let Some(e) = err {
        Err(format!(
            "Microsoft rechazó el login ({}): {}",
            e,
            err_desc.unwrap_or_default()
        ))
    } else {
        Err("No se recibió el código de Microsoft. Inténtalo de nuevo.".to_string())
    }
}

#[derive(Debug, Deserialize)]
struct MsTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
}

async fn ms_exchange_code(raw_code: &str) -> Result<(String, Option<String>), String> {
    // El code viaja URL-escaped en el callback; hay que decodificarlo.
    let code = urlencoding::decode(raw_code)
        .map(|s| s.into_owned())
        .unwrap_or_else(|_| raw_code.to_string());
    let params = [
        ("client_id", MS_CLIENT_ID.to_string()),
        ("code", code),
        ("grant_type", "authorization_code".to_string()),
        ("redirect_uri", MS_REDIRECT_URI.to_string()),
        ("scope", MS_SCOPE.to_string()),
    ];
    let v: serde_json::Value = ms_http()
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Error contactando a Microsoft: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Respuesta inválida de Microsoft: {}", e))?;
    if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
        let desc = v
            .get("error_description")
            .and_then(|e| e.as_str())
            .unwrap_or("");
        return Err(format!(
            "Microsoft rechazó el código ({}): {}",
            err,
            desc.chars().take(300).collect::<String>()
        ));
    }
    let access = v
        .get("access_token")
        .and_then(|t| t.as_str())
        .ok_or("Microsoft no devolvió access_token.")?
        .to_string();
    let refresh = v
        .get("refresh_token")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());
    Ok((access, refresh))
}

async fn ms_refresh(refresh_token: &str) -> Result<(String, Option<String>), String> {
    let params = [
        ("client_id", MS_CLIENT_ID.to_string()),
        ("refresh_token", refresh_token.to_string()),
        ("grant_type", "refresh_token".to_string()),
        ("scope", MS_SCOPE.to_string()),
    ];
    let res: MsTokenResponse = ms_http()
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Error renovando sesión: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Respuesta inválida de Microsoft: {}", e))?;
    Ok((res.access_token, res.refresh_token))
}

#[derive(Debug, Deserialize)]
struct XblResponse {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    display_claims: XblClaims,
}

#[derive(Debug, Deserialize)]
struct XblClaims {
    xui: Vec<XblXui>,
}

#[derive(Debug, Deserialize)]
struct XblXui {
    uhs: String,
}

#[derive(Debug, Deserialize)]
struct XstsResponse {
    #[serde(rename = "Token")]
    token: Option<String>,
    #[serde(rename = "XErr")]
    xerr: Option<i64>,
    #[serde(rename = "DisplayClaims")]
    display_claims: Option<XblClaims>,
}

fn xsts_error(xerr: i64) -> String {
    match xerr {
        2148916233 => "Esta cuenta Microsoft no tiene Minecraft Java vinculado.".to_string(),
        2148916235 => "Esta cuenta está baneada en Xbox Live.".to_string(),
        2148916238 => "Es una cuenta infantil: pide a un adulto que la autorice para jugar online.".to_string(),
        _ => format!("Xbox rechazó el login (código {}).", xerr),
    }
}

async fn xbox_login(ms_access_token: &str) -> Result<(String, String), String> {
    // 1. Xbox Live
    let xbl: XblResponse = ms_http()
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .header("x-xbl-contract-version", "1")
        .json(&serde_json::json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={}", ms_access_token),
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT",
        }))
        .send()
        .await
        .map_err(|e| format!("Error con Xbox Live: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Respuesta inválida de Xbox Live: {}", e))?;
    let uhs = xbl
        .display_claims
        .xui
        .first()
        .map(|x| x.uhs.clone())
        .ok_or("Xbox no devolvió identificador de usuario.")?;

    // 2. XSTS para Minecraft
    let xsts: XstsResponse = ms_http()
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .header("x-xbl-contract-version", "1")
        .json(&serde_json::json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbl.token],
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT",
        }))
        .send()
        .await
        .map_err(|e| format!("Error con XSTS: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Respuesta inválida de XSTS: {}", e))?;
    if let Some(err) = xsts.xerr {
        return Err(xsts_error(err));
    }
    let token = xsts.token.ok_or("XSTS no devolvió token.")?;
    // Verificación cruzada como Prism: el uhs del XSTS debe coincidir con el de Xbox.
    if let Some(xsts_uhs) = xsts
        .display_claims
        .as_ref()
        .and_then(|c| c.xui.first())
        .map(|x| x.uhs.clone())
    {
        if xsts_uhs != uhs {
            return Err("Xbox devolvió identidades inconsistentes (uhs distinto). Reintenta el login.".to_string());
        }
    }
    Ok((uhs, token))
}

#[derive(Debug, Deserialize)]
struct McProfileSkin {
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    state: Option<String>,
}

#[derive(Debug, Deserialize)]
struct McProfile {
    id: String,
    name: String,
    #[serde(default)]
    skins: Vec<McProfileSkin>,
}

/// Extrae access_token de una respuesta JSON de Minecraft Services.
fn extract_mc_token(v: &serde_json::Value) -> Option<String> {
    v.get("access_token")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
}

/// Intercambia Xbox (uhs + xsts) por token de Minecraft + perfil (nombre, uuid, skin).
/// Usa el endpoint de launchers (/launcher/login) como Prism y cía., con
/// fallback al clásico (/authentication/login_with_xbox).
async fn minecraft_login(uhs: &str, xsts_token: &str) -> Result<(String, String, String, Option<String>), String> {
    let xtoken = format!("XBL3.0 x={};{}", uhs, xsts_token);
    let mut first_err = String::new();
    let mut last_err = String::new();
    let mut mc_token: Option<String> = None;

    // Intento 1: endpoint de launchers (PC_LAUNCHER)
    match ms_http()
        .post("https://api.minecraftservices.com/launcher/login")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "xtoken": xtoken,
            "platform": "PC_LAUNCHER",
        }))
        .send()
        .await
    {
        Ok(resp) => {
            if resp.status().is_success() {
                if let Ok(v) = resp.json::<serde_json::Value>().await {
                    mc_token = extract_mc_token(&v);
                }
                if mc_token.is_none() {
                    first_err = "Respuesta sin access_token en /launcher/login".to_string();
                }
            } else {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                first_err = format!("HTTP {}: {}", status, body.chars().take(300).collect::<String>());
            }
        }
        Err(e) => {
            first_err = format!("Error con Minecraft Services: {}", e);
        }
    }

    // Intento 2 (fallback): endpoint clásico
    if mc_token.is_none() {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        match ms_http()
            .post("https://api.minecraftservices.com/authentication/login_with_xbox")
            .header("Accept", "application/json")
            .json(&serde_json::json!({ "identityToken": xtoken }))
            .send()
            .await
        {
            Ok(resp) => {
                if resp.status().is_success() {
                    if let Ok(v) = resp.json::<serde_json::Value>().await {
                        mc_token = extract_mc_token(&v);
                    }
                    if mc_token.is_none() {
                        last_err = "Respuesta sin access_token en login_with_xbox".to_string();
                    }
                } else {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    last_err = format!("HTTP {}: {}", status, body.chars().take(300).collect::<String>());
                }
            }
            Err(e) => {
                last_err = format!("Error con Minecraft Services: {}", e);
            }
        }
    }

    let mc_token = match mc_token {
        Some(t) => t,
        None => {
            let combined = format!("{} || {}", first_err, last_err);
            if combined.contains("NOT_FOUND")
                || combined.contains("No Minecraft account")
                || combined.contains("does not own")
            {
                return Err("Esta cuenta Microsoft no tiene Minecraft: Java Edition comprado o vinculado.".to_string());
            }
            let detail: String = combined.chars().take(600).collect();
            return Err(format!("Minecraft Services rechazó el login: {}", detail));
        }
    };
    let tok = mc_token;

    let profile_resp = ms_http()
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&tok)
        .send()
        .await
        .map_err(|e| format!("Error obteniendo perfil: {}", e))?;
    if profile_resp.status() == reqwest::StatusCode::NOT_FOUND
        || profile_resp.status() == reqwest::StatusCode::UNAUTHORIZED
    {
        return Err("Esta cuenta no tiene Minecraft: Java Edition comprado.".to_string());
    }
    if !profile_resp.status().is_success() {
        return Err(format!("Error obteniendo perfil (HTTP {})", profile_resp.status()));
    }
    let profile: McProfile = profile_resp
        .json()
        .await
        .map_err(|e| format!("Perfil inválido: {}", e))?;
    let skin = profile
        .skins
        .iter()
        .find(|s| s.state.as_deref() == Some("ACTIVE"))
        .or_else(|| profile.skins.first());
    Ok((
        tok,
        profile.id,
        profile.name,
        skin.and_then(|s| s.url.clone()),
    ))
}

async fn build_microsoft_account(
    ms_access_token: &str,
    refresh_token: Option<String>,
) -> Result<Account, String> {
    let (uhs, xsts) = xbox_login(ms_access_token).await?;
    let (mc_token, uuid, name, skin) = minecraft_login(&uhs, &xsts).await?;
    Ok(Account {
        account_type: "microsoft".to_string(),
        username: name,
        uuid,
        access_token: Some(mc_token),
        skin_url: skin,
        is_logged_in: true,
        refresh_token,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedAccount {
    pub username: String,
    #[serde(rename = "type")]
    pub account_type: String,
    #[serde(rename = "skinUrl")]
    pub skin_url: Option<String>,
    #[serde(rename = "lastUsed")]
    pub last_used: String,
}

pub struct AuthState {
    pub account: Option<Account>,
}

fn app_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("LTC Launcher")
}

fn saved_accounts_path() -> PathBuf {
    app_data_dir().join("saved_accounts.json")
}

fn session_path() -> PathBuf {
    app_data_dir().join("session.json")
}

fn read_session() -> Option<Account> {
    std::fs::read_to_string(session_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn write_session(account: Option<&Account>) {
    let path = session_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    match account {
        Some(acc) => {
            if let Ok(json) = serde_json::to_string(acc) {
                let _ = std::fs::write(&path, json);
            }
        }
        None => {
            let _ = std::fs::remove_file(&path);
        }
    }
}

impl Default for AuthState {
    fn default() -> Self {
        Self {
            account: read_session(),
        }
    }
}

#[tauri::command]
pub async fn login_microsoft(
    app_handle: AppHandle,
    state: State<'_, Mutex<AuthState>>,
) -> Result<Account, String> {
    // 1. Abrir el navegador con tu app de Azure (LTC)
    let auth_url = format!(
        "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id={}&response_type=code&redirect_uri={}&response_mode=query&scope={}&prompt=select_account",
        MS_CLIENT_ID,
        urlencoding::encode(MS_REDIRECT_URI),
        urlencoding::encode(MS_SCOPE),
    );
    app_handle
        .shell()
        .open(&auth_url, None)
        .map_err(|e| format!("No se pudo abrir el navegador: {}", e))?;

    // 2. Esperar el callback en http://localhost:1653
    let code = wait_for_ms_code().await?;

    // 3. Canjear code -> tokens -> Xbox -> Minecraft -> perfil
    let (ms_token, refresh) = ms_exchange_code(&code).await?;
    let account = build_microsoft_account(&ms_token, refresh).await?;

    let mut auth = state.lock().map_err(|e| e.to_string())?;
    auth.account = Some(account.clone());
    write_session(Some(&account));

    Ok(account)
}

#[tauri::command]
pub async fn login_offline(
    username: String,
    state: State<'_, Mutex<AuthState>>,
) -> Result<Account, String> {
    if username.is_empty() || username.len() > 16 {
        return Err("El nombre debe tener entre 1 y 16 caracteres".to_string());
    }

    let uuid = Uuid::new_v4().to_string().replace("-", "");
    let account = Account {
        account_type: "offline".to_string(),
        username,
        uuid,
        access_token: Some("0".to_string()),
        skin_url: None,
        is_logged_in: true,
        refresh_token: None,
    };

    let mut auth = state.lock().map_err(|e| e.to_string())?;
    auth.account = Some(account.clone());
    write_session(Some(&account));

    Ok(account)
}

#[tauri::command]
pub async fn logout(state: State<'_, Mutex<AuthState>>) -> Result<(), String> {
    let mut auth = state.lock().map_err(|e| e.to_string())?;
    auth.account = None;
    write_session(None);
    Ok(())
}

#[tauri::command]
pub async fn check_session(
    state: State<'_, Mutex<AuthState>>,
) -> Result<Option<Account>, String> {
    let stored = {
        let auth = state.lock().map_err(|e| e.to_string())?;
        auth.account.clone()
    };
    let Some(acc) = stored else {
        return Ok(None);
    };
    // Renovar en silencio las sesiones Microsoft (el token de Minecraft caduca).
    if acc.account_type == "microsoft" {
        if let Some(refresh) = acc.refresh_token.clone() {
            if let Ok((ms_token, new_refresh)) = ms_refresh(&refresh).await {
                let keep_refresh = new_refresh.or(Some(refresh));
                if let Ok(fresh) = build_microsoft_account(&ms_token, keep_refresh).await {
                    let mut auth = state.lock().map_err(|e| e.to_string())?;
                    auth.account = Some(fresh.clone());
                    write_session(Some(&fresh));
                    return Ok(Some(fresh));
                }
            }
        }
    }
    Ok(Some(acc))
}

#[tauri::command]
pub fn get_saved_accounts() -> Vec<SavedAccount> {
    std::fs::read_to_string(saved_accounts_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn save_saved_accounts(accounts: Vec<SavedAccount>) -> Result<(), String> {
    let path = saved_accounts_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&accounts).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}
