use crate::plugins::tauri_plugin_share::SharePluginState;
use crate::MappingStatus;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use hyper_util::rt::TokioIo;
use http_body_util::{Empty, BodyExt};
use hyper::body::Bytes;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::net::SocketAddr;
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;

#[derive(Deserialize, Serialize, Debug, Clone)]
struct ProxyConfig {
    /// 请求的 base path
    from: String,
    /// 目标地址
    target: String,
    /// 是否改变 origin，默认为 `false`，设置为 `true` 避免跨域
    change_origin: Option<bool>,
    /// 路径重写
    rewrite: Option<String>,
    /// 是否为 websocket
    ws: Option<bool>,
    /// 是否改变 websocket origin，默认为 `false`，设置为 `true` 避免跨域
    rewrite_ws_origin: Option<bool>,
    #[serde(default)]
    status: MappingStatus,
}

fn read_listen_port_state(state: &SharePluginState) -> u16 {
    let state = state.0.lock().unwrap();
    let v = state
        .mapping
        .get("listen_port")
        .cloned()
        .unwrap_or(String::from("0"));

    v.parse::<u16>().unwrap()
}

fn read_proxy_config(state: &SharePluginState, path: &str) -> Option<(String, ProxyConfig)> {
    let state = state.0.lock().unwrap();

    // 查找最长匹配的前缀
    let mut matched: Option<(String, ProxyConfig)> = None;

    for (key, value) in state.mapping.iter() {
        if let Some(from) = key.strip_prefix("[#from]") {
            if path.starts_with(from) {
                if let Ok(config) = serde_json::from_str::<ProxyConfig>(value) {
                    if config.status == MappingStatus::Inactive {
                        continue;
                    }

                    // 保留最长匹配
                    if matched.is_none() || from.len() > matched.as_ref().unwrap().0.len() {
                        matched = Some((from.to_string(), config));
                    }
                }
            }
        }
    }

    matched
}

#[allow(unused)]
pub async fn start_proxy(
    app: &AppHandle,
    mut listen_port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let _state = app.state::<SharePluginState>().clone();
    let listen_port_state = read_listen_port_state(&_state);
    // if listen_port_state 不为 ""，则使用 listen_port_state
    if listen_port_state != 0 {
        listen_port = listen_port_state;
    }
    let target_url_path = "localhost:8188".to_string();
    let client_instance = Client::builder(TokioExecutor::new()).build_http();
    let addr = SocketAddr::from(([0, 0, 0, 0], listen_port));

    // We create a TcpListener and bind it to 127.0.0.1:8888
    let listener = TcpListener::bind(addr).await?;

    // We start a loop to continuously accept incoming connections
    loop {
        let app = app.clone();
        let (stream, _) = listener.accept().await?;

        // Use an adapter to access something implementing `tokio::io` traits as if they implement
        // `hyper::rt` IO traits.
        let io = TokioIo::new(stream);

        // Spawn a tokio task to serve multiple connections concurrently
        let client_instance_cloned = client_instance.clone();
        let target_url_path_cloned = target_url_path.clone();
        tokio::task::spawn(async move {
            let handler = service_fn(move |req: Request<hyper::body::Incoming>| {
                let state = app.state::<SharePluginState>();
                let original_path = req.uri().path().to_string();
                let proxy_result = read_proxy_config(&state, &original_path);
                let client = client_instance_cloned.clone();

                async move {
                    match proxy_result {
                        Some((from, cfg)) => {
                            let target_uri: hyper::Uri = cfg.target.parse().unwrap();

                            // 路径重写逻辑
                            let new_path = if let Some(rewrite) = &cfg.rewrite {
                                // 将 from 替换为 rewrite
                                original_path.replacen(&from, rewrite, 1)
                            } else {
                                original_path.clone()
                            };

                            let new_uri = hyper::Uri::builder()
                                .scheme(target_uri.scheme_str().unwrap_or("http"))
                                .authority(target_uri.authority().unwrap().as_str())
                                .path_and_query(new_path)
                                .build()
                                .unwrap();

                            let (mut parts, body) = req.into_parts();
                            parts.uri = new_uri;
                            let new_req = Request::from_parts(parts, body);

                            let resp = client.request(new_req).await.unwrap();
                            let (parts, body) = resp.into_parts();
                            let boxed_body = body.boxed();
                            Ok::<_, Infallible>(Response::from_parts(parts, boxed_body))
                        }
                        None => {
                            let resp = Response::builder()
                                .status(404)
                                .body(Empty::<Bytes>::new().map_err(|_| unreachable!()).boxed())
                                .unwrap();
                            Ok::<_, Infallible>(resp)
                        }
                    }
                }
            });

            if let Err(err) = http1::Builder::new()
                // `service_fn` converts our function in a `Service`
                .serve_connection(io, handler)
                .await
            {
                eprintln!("Error serving connection: {:?}", err);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::tauri_plugin_share::ShareState;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[test]
    fn matches_only_active_mappings_using_the_longest_prefix() {
        let state = SharePluginState(Mutex::new(ShareState {
            mapping: HashMap::from([
                (
                    "[#from]/api".into(),
                    r#"{"from":"/api","target":"http://localhost:8080"}"#.into(),
                ),
                (
                    "[#from]/api/v1".into(),
                    r#"{"from":"/api/v1","target":"http://localhost:8081","status":"active"}"#.into(),
                ),
                (
                    "[#from]/api/v1/private".into(),
                    r#"{"from":"/api/v1/private","target":"http://localhost:8082","status":"inactive"}"#.into(),
                ),
                (
                    "[#from]/inactive".into(),
                    r#"{"from":"/inactive","target":"http://localhost:8083","status":"inactive"}"#.into(),
                ),
            ]),
        }));

        assert_eq!(read_proxy_config(&state, "/api/v2").unwrap().0, "/api");
        assert_eq!(
            read_proxy_config(&state, "/api/v1/private").unwrap().0,
            "/api/v1"
        );
        assert!(read_proxy_config(&state, "/inactive").is_none());
    }
}
