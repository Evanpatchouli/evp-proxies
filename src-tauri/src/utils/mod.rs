fn read_proxy_config(
    state: &SharePluginState,
    from: &str,
) -> Option<ProxyConfig> {
    let key = format!("[#from]{}", from);

    let state = state.0.lock().unwrap();
    let value = state.mapping.get(&key)?;

    serde_json::from_str::<ProxyConfig>(value).ok()
}
