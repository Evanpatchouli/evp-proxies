#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mapping_store;
mod plugins;
mod proxy;
mod updates;
use plugins::tauri_plugin_share::{self, SharePluginState};
use tauri::State;

#[derive(serde::Serialize, serde::Deserialize, Debug, Default, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum MappingStatus {
    #[default]
    Active,
    Inactive,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ProxyMapping {
    from: String,
    target: String,
    change_origin: Option<bool>,
    rewrite: Option<String>,
    #[serde(default)]
    status: MappingStatus,
}

#[tauri::command]
fn add_proxy_mapping(
    state: State<'_, SharePluginState>,
    mapping: ProxyMapping,
) -> Result<(), String> {
    let key = format!("{}{}", mapping_store::RULE_PREFIX, mapping.from);
    let value = serde_json::to_string(&mapping).map_err(|e| e.to_string())?;

    state.with(|db| db.put(&key, &value, false))?;

    Ok(())
}

#[tauri::command]
fn remove_proxy_mapping(state: State<'_, SharePluginState>, from: String) -> Result<(), String> {
    state.with(|db| db.remove(&format!("{}{from}", mapping_store::RULE_PREFIX)))
}

#[tauri::command]
fn set_proxy_mapping_status(
    state: State<'_, SharePluginState>,
    from: String,
    status: MappingStatus,
) -> Result<(), String> {
    if state.with(|db| db.set_status(&from, status))? {
        Ok(())
    } else {
        Err("映射不存在".into())
    }
}

#[tauri::command]
fn get_proxy_mappings(state: State<'_, SharePluginState>) -> Result<Vec<ProxyMapping>, String> {
    state.with(|db| db.rules())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(updates::DownloadState::default())
        .plugin(tauri_plugin_share::init())
        .invoke_handler(tauri::generate_handler![
            add_proxy_mapping,
            remove_proxy_mapping,
            set_proxy_mapping_status,
            get_proxy_mappings,
            updates::check_update,
            updates::release_history,
            updates::install_update,
            updates::cancel_download
        ])
        .setup(|_app| {
            let app_handle = _app.handle().clone();
            // 启动后台代理线程
            tauri::async_runtime::spawn(async move {
                let _ = proxy::start_proxy(&app_handle, 9420).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
