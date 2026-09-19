mod commands;
mod config;
mod minecraft;

use commands::{auth, curseforge, instance, mods_cmd, mods_source, update};
use config::AppConfig;
use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    let app_config = AppConfig::load();
    std::fs::create_dir_all(&app_config.instances_dir).ok();

    let instance_state = instance::InstanceState {
        config: app_config,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(Mutex::new(auth::AuthState::default()))
        .manage(Mutex::new(instance_state))
        .setup(|app| {
            // Icono propio en la ventana y la barra de tareas (en dev el exe no lleva icono embebido)
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(icon) =
                    tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
                {
                    let _ = window.set_icon(icon);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::login_microsoft,
            auth::login_microsoft_with_code,
            auth::get_ms_auth_url,
            auth::open_ms_auth_page,
            auth::login_offline,
            auth::default_skin_kind,
            auth::default_skin_dataurl,
            auth::logout,
            auth::check_session,
            auth::get_saved_accounts,
            auth::save_saved_accounts,
            instance::get_instances,
            instance::create_instance,
            instance::update_instance,
            instance::delete_instance,
            instance::launch_instance,
            instance::sync_and_launch,
            instance::install_instance,
            instance::admin_login,
            mods_cmd::add_mod_local,
            mods_cmd::remove_mod,
            mods_cmd::toggle_mod,
            mods_cmd::resolve_mod_icons,
            mods_cmd::export_mods_archive,
            update::check_update_info,
            update::is_update_newer,
            update::get_update_url,
            update::set_update_url,
            update::download_update,
            update::apply_update_and_restart,
            update::start_publish_release,
            update::test_release_window,
            mods_source::set_mods_source_folder,
            mods_source::set_mods_source_archive,
            mods_source::set_mods_source_url,
            mods_source::get_default_mods_url,
            mods_source::clear_mods_source,
            mods_source::sync_mods_source_now,
            mods_source::set_github_token,
            mods_source::has_github_token,
            mods_source::publish_mods_pack,
            curseforge::search_modrinth,
            curseforge::get_modrinth_versions,
            minecraft::loaders::list_forge_versions,
            minecraft::loaders::list_fabric_versions,
            curseforge::search_curseforge,
            curseforge::get_curseforge_files,
            curseforge::install_mod_from_url,
            curseforge::download_file_to_disk,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LTC Launcher");
}
