use serde::Serialize;
use serde_json::Value;
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const GITHUB_LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/Real-Dark-Horse/LocalAi/releases/latest";
const FALLBACK_DOWNLOAD_URL: &str =
    "https://github.com/Real-Dark-Horse/LocalAi/releases/latest/download/LocalAI.exe";
const FALLBACK_RELEASE_URL: &str =
    "https://github.com/Real-Dark-Horse/LocalAi/releases/latest";

#[derive(Debug, Clone, Serialize)]
pub struct UpdateCheckResult {
    pub checked: bool,
    pub update_available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub download_url: String,
    pub release_url: String,
    pub release_notes: Option<String>,
    pub error: Option<String>,
}

pub fn parse_semver(raw: &str) -> Option<(u64, u64, u64)> {
    let trimmed = raw.trim().trim_start_matches(['v', 'V']);
    let core = trimmed.split(['-', '+']).next()?.trim();
    if core.is_empty() {
        return None;
    }
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    Some((major, minor, patch))
}

pub fn is_newer_version(current: &str, latest: &str) -> bool {
    match (parse_semver(current), parse_semver(latest)) {
        (Some(cur), Some(lat)) => lat > cur,
        _ => false,
    }
}

pub fn parse_release_payload(raw_json: &str, current_version: &str) -> Result<UpdateCheckResult, String> {
    let val: Value = serde_json::from_str(raw_json).map_err(|e| format!("Invalid JSON: {e}"))?;

    if let Some(msg) = val.get("message").and_then(|v| v.as_str()) {
        if val.get("tag_name").is_none() {
            return Err(msg.to_string());
        }
    }

    let tag = val
        .get("tag_name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().trim_start_matches(['v', 'V']).to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Release tag not found".to_string())?;

    let release_url = val
        .get("html_url")
        .and_then(|v| v.as_str())
        .filter(|s| s.starts_with("https://"))
        .unwrap_or(FALLBACK_RELEASE_URL)
        .to_string();

    let mut download_url = FALLBACK_DOWNLOAD_URL.to_string();
    if let Some(assets) = val.get("assets").and_then(|v| v.as_array()) {
        for asset in assets {
            let name = asset.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let url = asset
                .get("browser_download_url")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if name.to_ascii_lowercase().ends_with(".exe") && url.starts_with("https://") {
                download_url = url.to_string();
                break;
            }
        }
    }

    let release_notes = val
        .get("body")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let update_available = is_newer_version(current_version, &tag);

    Ok(UpdateCheckResult {
        checked: true,
        update_available,
        current_version: current_version.to_string(),
        latest_version: Some(tag),
        download_url,
        release_url,
        release_notes,
        error: None,
    })
}

fn fetch_latest_release_blocking() -> UpdateCheckResult {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let mut cmd = Command::new("curl.exe");
    cmd.args([
        "-sSL",
        "--max-time",
        "8",
        "-H",
        "User-Agent: LocalAI-Desktop",
        "-H",
        "Accept: application/vnd.github+json",
        GITHUB_LATEST_RELEASE_API,
    ]);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = match cmd.output() {
        Ok(out) => out,
        Err(err) => {
            return UpdateCheckResult {
                checked: false,
                update_available: false,
                current_version,
                latest_version: None,
                download_url: FALLBACK_DOWNLOAD_URL.to_string(),
                release_url: FALLBACK_RELEASE_URL.to_string(),
                release_notes: None,
                error: Some(format!("Could not check for updates: {err}")),
            };
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return UpdateCheckResult {
            checked: false,
            update_available: false,
            current_version,
            latest_version: None,
            download_url: FALLBACK_DOWNLOAD_URL.to_string(),
            release_url: FALLBACK_RELEASE_URL.to_string(),
            release_notes: None,
            error: Some(if stderr.is_empty() {
                "Update check failed (offline or GitHub unreachable)".to_string()
            } else {
                stderr
            }),
        };
    }

    let body = String::from_utf8_lossy(&output.stdout);
    match parse_release_payload(&body, &current_version) {
        Ok(res) => res,
        Err(err) => UpdateCheckResult {
            checked: false,
            update_available: false,
            current_version,
            latest_version: None,
            download_url: FALLBACK_DOWNLOAD_URL.to_string(),
            release_url: FALLBACK_RELEASE_URL.to_string(),
            release_notes: None,
            error: Some(err),
        },
    }
}

#[tauri::command]
pub async fn check_for_update() -> UpdateCheckResult {
    tokio::task::spawn_blocking(fetch_latest_release_blocking)
        .await
        .unwrap_or_else(|e| UpdateCheckResult {
            checked: false,
            update_available: false,
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            latest_version: None,
            download_url: FALLBACK_DOWNLOAD_URL.to_string(),
            release_url: FALLBACK_RELEASE_URL.to_string(),
            release_notes: None,
            error: Some(format!("Update task failed: {e}")),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_semver_versions() {
        assert!(is_newer_version("0.2.0", "v0.2.1"));
        assert!(is_newer_version("0.2.0", "0.3.0"));
        assert!(is_newer_version("0.2.0", "1.0.0"));
        assert!(!is_newer_version("0.2.0", "v0.2.0"));
        assert!(!is_newer_version("0.2.1", "0.2.0"));
        assert!(!is_newer_version("0.2.0", "0.2.0-beta.1"));
    }

    #[test]
    fn parses_github_release_json() {
        let json = r#"{
            "tag_name": "v0.3.0",
            "html_url": "https://github.com/Real-Dark-Horse/LocalAi/releases/tag/v0.3.0",
            "body": "Added Chat Mode and speed improvements.",
            "assets": [
                {
                    "name": "LocalAI.exe",
                    "browser_download_url": "https://github.com/Real-Dark-Horse/LocalAi/releases/download/v0.3.0/LocalAI.exe"
                }
            ]
        }"#;
        let res = parse_release_payload(json, "0.2.0").expect("should parse");
        assert!(res.checked);
        assert!(res.update_available);
        assert_eq!(res.latest_version.as_deref(), Some("0.3.0"));
        assert_eq!(
            res.download_url,
            "https://github.com/Real-Dark-Horse/LocalAi/releases/download/v0.3.0/LocalAI.exe"
        );
    }
}
