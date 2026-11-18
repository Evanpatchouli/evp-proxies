#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod plugins;
mod proxy;
use plugins::tauri_plugin_share::{self, SharePluginState};
use tauri::{Manager, State};

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
    let key = format!("[#from]{}", mapping.from);
    let value = serde_json::to_string(&mapping).map_err(|e| e.to_string())?;

    let mut share_state = state.0.lock().unwrap();
    share_state.mapping.insert(key, value);

    Ok(())
}

#[tauri::command]
fn remove_proxy_mapping(state: State<'_, SharePluginState>, from: String) -> Result<(), String> {
    let key = format!("[#from]{}", from);

    let mut share_state = state.0.lock().unwrap();
    share_state.mapping.remove(&key);

    Ok(())
}

#[tauri::command]
fn set_proxy_mapping_status(
    state: State<'_, SharePluginState>,
    from: String,
    status: MappingStatus,
) -> Result<(), String> {
    let key = format!("[#from]{}", from);
    let mut share_state = state.0.lock().unwrap();
    let value = share_state.mapping.get_mut(&key).ok_or("映射不存在")?;
    let mut mapping: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(value).map_err(|e| e.to_string())?;

    mapping.insert(
        "status".into(),
        serde_json::to_value(status).map_err(|e| e.to_string())?,
    );
    *value = serde_json::to_string(&mapping).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_proxy_mappings(state: State<'_, SharePluginState>) -> Result<Vec<ProxyMapping>, String> {
    let share_state = state.0.lock().unwrap();
    let mut mappings = Vec::new();

    for (key, value) in share_state.mapping.iter() {
        if key.starts_with("[#from]") {
            if let Ok(mapping) = serde_json::from_str::<ProxyMapping>(value) {
                mappings.push(mapping);
            }
        }
    }

    Ok(mappings)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_share::init())
        .invoke_handler(tauri::generate_handler![
            add_proxy_mapping,
            remove_proxy_mapping,
            set_proxy_mapping_status,
            get_proxy_mappings
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
