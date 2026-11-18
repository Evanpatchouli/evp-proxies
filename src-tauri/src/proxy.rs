use crate::plugins::tauri_plugin_share::SharePluginState;
use http_body_util::{BodyExt, Empty};
use hyper::body::Bytes;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use std::net::SocketAddr;
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;

#[allow(unused)]
pub async fn start_proxy(
    app: &AppHandle,
    mut listen_port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let _state = app.state::<SharePluginState>().clone();
    let listen_port_state = _state
        .with(|db| db.get("listen_port"))?
        .and_then(|port| port.parse::<u16>().ok())
        .unwrap_or(0);
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
                let proxy_result = state.with(|db| db.find_rule(&original_path));
                let client = client_instance_cloned.clone();

                async move {
                    match proxy_result {
                        Ok(Some(cfg)) => {
                            let target_uri: hyper::Uri = cfg.target.parse().unwrap();

                            // 路径重写逻辑
                            let new_path = if let Some(rewrite) = &cfg.rewrite {
                                // 将 from 替换为 rewrite
                                original_path.replacen(&cfg.from, rewrite, 1)
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
                        missing_or_error => {
                            let resp = Response::builder()
                                .status(if missing_or_error.is_err() { 503 } else { 404 })
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
