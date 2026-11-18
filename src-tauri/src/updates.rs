use reqwest::{redirect::Policy, Client, StatusCode, Url};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{io::Write, sync::Mutex, time::Duration};
use tauri::{ipc::Channel, AppHandle, State};
use tokio::sync::watch;

const LATEST: &str = "https://api.github.com/repos/Evanpatchouli/evp-proxies/releases/latest";

#[derive(Default)]
pub struct DownloadState(Mutex<Option<watch::Sender<bool>>>);

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: Url,
    size: u64,
    digest: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct Release {
    tag_name: String,
    published_at: String,
    body: Option<String>,
    draft: bool,
    prerelease: bool,
    #[serde(skip_serializing)]
    assets: Vec<Asset>,
}

#[tauri::command]
pub async fn release_history() -> Result<Vec<Release>, String> {
    let response = client()?
        .get("https://api.github.com/repos/Evanpatchouli/evp-proxies/releases?per_page=20")
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let releases: Vec<Release> = response.json().await.map_err(|e| e.to_string())?;
    let mut stable: Vec<_> = releases
        .into_iter()
        .filter(|r| !r.draft && !r.prerelease)
        .filter_map(|r| {
            Version::parse(r.tag_name.trim_start_matches('v'))
                .ok()
                .map(|v| (v, r))
        })
        .collect();
    stable.sort_by(|a, b| b.0.cmp_precedence(&a.0));
    Ok(stable.into_iter().map(|(_, release)| release).collect())
}

fn trusted(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| {
            host == "api.github.com"
                || host == "github.com"
                || host.ends_with(".githubusercontent.com")
        })
}

fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent(concat!("evp-proxies/", env!("CARGO_PKG_VERSION")))
        .redirect(Policy::custom(|attempt| {
            if trusted(attempt.url()) && attempt.previous().len() < 8 {
                attempt.follow()
            } else {
                attempt.error("更新下载地址无效")
            }
        }))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

fn newer(tag: &str) -> Result<bool, String> {
    let version = Version::parse(tag.trim_start_matches('v')).map_err(|e| e.to_string())?;
    Ok(version
        .cmp_precedence(&Version::parse(env!("CARGO_PKG_VERSION")).unwrap())
        .is_gt())
}

async fn latest(client: &Client) -> Result<Option<Release>, String> {
    let response = client
        .get(LATEST)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let release = response
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(Some(release))
}

#[derive(Serialize)]
pub struct Check {
    release: Option<Release>,
    available: bool,
}

#[tauri::command]
pub async fn check_update() -> Result<Check, String> {
    let release = latest(&client()?).await?;
    let available = release
        .as_ref()
        .map(|r| newer(&r.tag_name))
        .transpose()?
        .unwrap_or(false);
    Ok(Check { release, available })
}

#[derive(Clone, Serialize)]
pub struct Progress {
    stage: &'static str,
    received: u64,
    total: u64,
}

async fn download(tag: &str, progress: &Channel<Progress>) -> Result<tempfile::TempPath, String> {
    let client = client()?;
    let release = latest(&client).await?.ok_or("项目暂未发布 Release")?;
    if release.tag_name != tag || !newer(tag)? {
        return Err("发布版本已变化，请重新检查更新".into());
    }
    let name = format!("EvpProxies.Setup.{}.exe", tag.trim_start_matches('v'));
    let asset = release
        .assets
        .iter()
        .find(|a| a.name == name)
        .ok_or("未找到 Windows 安装包")?;
    let digest = asset
        .digest
        .as_deref()
        .and_then(|s| s.strip_prefix("sha256:"))
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("安装包缺少 SHA-256 摘要")?;
    if !trusted(&asset.browser_download_url) || asset.size < 2 {
        return Err("安装包地址或大小无效".into());
    }
    let mut response = client
        .get(asset.browser_download_url.clone())
        .timeout(Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let mut file = tempfile::Builder::new()
        .prefix("evp-proxies-update-")
        .suffix(".exe")
        .tempfile()
        .map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut received = 0;
    let mut header = Vec::<u8>::with_capacity(2);
    let mut last_percent = None;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        received += chunk.len() as u64;
        if received > asset.size {
            return Err("安装包大小超过发布记录".into());
        }
        header.extend(chunk.iter().take(2 - header.len()));
        hash.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        let percent = received.saturating_mul(100) / asset.size;
        if last_percent != Some(percent) {
            progress
                .send(Progress {
                    stage: "download",
                    received,
                    total: asset.size,
                })
                .map_err(|e| e.to_string())?;
            last_percent = Some(percent);
        }
    }
    progress
        .send(Progress {
            stage: "verify",
            received,
            total: asset.size,
        })
        .map_err(|e| e.to_string())?;
    if received != asset.size
        || header != b"MZ"
        || !format!("{:x}", hash.finalize()).eq_ignore_ascii_case(digest)
    {
        return Err("安装包完整性校验失败".into());
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(file.into_temp_path())
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    state: State<'_, DownloadState>,
    tag: String,
    progress: Channel<Progress>,
) -> Result<(), String> {
    if !cfg!(all(windows, not(debug_assertions))) {
        return Err("请在 Windows 正式版中安装更新".into());
    }
    let (cancel, mut cancelled) = watch::channel(false);
    {
        let mut active = state.0.lock().unwrap();
        if active.is_some() {
            return Err("已有更新正在进行".into());
        }
        *active = Some(cancel);
    }
    let result = tokio::select! {
        biased;
        _ = cancelled.changed() => Err("下载已取消".to_string()),
        file = download(&tag, &progress) => file,
    };
    let mut active = state.0.lock().unwrap();
    active.take();
    let installer = result?;
    progress
        .send(Progress {
            stage: "install",
            received: 0,
            total: 0,
        })
        .map_err(|e| e.to_string())?;
    let path = installer.keep().map_err(|e| e.to_string())?;
    if let Err(e) = std::process::Command::new(&path)
        .args(["/S", "/UPDATE", "/R"])
        .spawn()
    {
        let _ = std::fs::remove_file(path);
        return Err(format!("启动安装程序失败：{e}"));
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn cancel_download(state: State<'_, DownloadState>) {
    if let Some(sender) = state.0.lock().unwrap().as_ref() {
        let _ = sender.send(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_https_github_downloads() {
        for (url, allowed) in [
            ("https://release-assets.githubusercontent.com/a", true),
            ("https://github.com/a", true),
            ("http://github.com/a", false),
            ("https://github.com.example.org/a", false),
        ] {
            assert_eq!(trusted(&Url::parse(url).unwrap()), allowed);
        }
    }
}
