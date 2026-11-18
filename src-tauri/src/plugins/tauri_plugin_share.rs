use crate::mapping_store::{MappingStore, DATABASE};
use std::{collections::HashMap, sync::Mutex};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Emitter, Manager, Runtime, State,
};

pub struct SharePluginState(Mutex<Result<MappingStore, String>>);

impl SharePluginState {
    pub fn with<T>(
        &self,
        op: impl FnOnce(&mut MappingStore) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        let mut guard = self.0.lock().map_err(|e| e.to_string())?;
        let db = guard.as_mut().map_err(|e| e.clone())?;
        op(db).map_err(|e| format!("本地映射数据库：{e}"))
    }
}

#[tauri::command]
fn register<R: Runtime>(
    _app: AppHandle<R>,
    _state: State<'_, SharePluginState>,
    key: String,
    val: String,
    if_not_exists: bool,
    broadcast: bool,
) -> Result<(), String> {
    let changed = _state.with(|db| db.put(&key, &val, if_not_exists))?;
    if changed && broadcast {
        _app.emit(&format!("plugin:share:update:{key}"), val)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn update<R: Runtime>(
    _app: AppHandle<R>,
    _state: State<'_, SharePluginState>,
    key: String,
    val: String,
) -> Result<(), String> {
    register(_app, _state, key, val, false, true)
}

#[tauri::command]
fn request(_state: State<'_, SharePluginState>, key: String) -> Result<Option<String>, String> {
    _state.with(|db| db.get(&key))
}

#[tauri::command]
fn has(_state: State<'_, SharePluginState>, key: String) -> Result<bool, String> {
    Ok(request(_state, key)?.is_some())
}

#[tauri::command]
fn entries(_state: State<'_, SharePluginState>) -> Result<Vec<(String, String)>, String> {
    _state.with(|db| db.entries())
}

#[tauri::command]
fn keys(_state: State<'_, SharePluginState>) -> Result<Vec<String>, String> {
    Ok(entries(_state)?.into_iter().map(|(k, _)| k).collect())
}

#[tauri::command]
fn values(_state: State<'_, SharePluginState>) -> Result<Vec<String>, String> {
    Ok(entries(_state)?.into_iter().map(|(_, v)| v).collect())
}

#[tauri::command]
fn mapping(_state: State<'_, SharePluginState>) -> Result<HashMap<String, String>, String> {
    Ok(entries(_state)?.into_iter().collect())
}

#[tauri::command]
fn size(_state: State<'_, SharePluginState>) -> Result<usize, String> {
    Ok(entries(_state)?.len())
}

#[tauri::command]
fn clear(_state: State<'_, SharePluginState>) -> Result<bool, String> {
    _state.with(MappingStore::clear)?;
    Ok(true)
}

#[tauri::command]
fn remove(_state: State<'_, SharePluginState>, key: String) -> Result<bool, String> {
    _state.with(|db| db.remove(&key))?;
    Ok(true)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("share")
        .invoke_handler(tauri::generate_handler![
            register, request, update, has, keys, clear, remove, values, size, mapping, entries
        ])
        .setup(|app, _api| {
            let directory = app.path().app_local_data_dir()?;
            let path = directory.join(DATABASE);
            let store = std::fs::create_dir_all(directory)
                .map_err(|e| e.to_string())
                .and_then(|_| MappingStore::open(&path).map_err(|e| e.to_string()))
                .map_err(|e| format!("无法打开 {}：{e}", path.display()));
            app.manage(SharePluginState(Mutex::new(store)));
            Ok(())
        })
        .build()
}
