use crate::errors::{AppError, AppResult};
use crate::workspace_fs::canonical_workspace_root;
use serde::Serialize;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const MAX_OUTPUT_TAIL: usize = 8192;

#[derive(Debug, Clone, Serialize)]
pub struct CommandResult {
    pub exit_code: i32,
    pub stdout_tail: String,
    pub stderr_tail: String,
    pub timed_out: bool,
}

fn is_drive_root_delete(lower: &str) -> bool {
    let delete_verbs = ["rd ", "rmdir ", "del ", "erase ", "rm -rf", "remove-item"];
    if !delete_verbs.iter().any(|v| lower.contains(v)) {
        return false;
    }
    let root_targets = ["c:\\", "d:\\", "e:\\", "c:/", "d:/", " / ", " /*"];
    root_targets.iter().any(|r| lower.contains(r))
        && (lower.contains("/s") || lower.contains("-rf") || lower.contains("-recurse"))
}

pub fn check_blocklist(cmd: &str) -> Option<&'static str> {
    let lower = format!(" {} ", cmd.trim().to_lowercase());
    if is_drive_root_delete(&lower) {
        return Some("Recursive deletion of a drive root is blocked");
    }

    let tokens: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
        .filter(|s| !s.is_empty())
        .collect();

    if tokens.contains(&"format") {
        return Some("Command 'format' is blocked");
    }
    if tokens.contains(&"diskpart") {
        return Some("Command 'diskpart' is blocked");
    }
    if tokens.contains(&"shutdown") {
        return Some("Command 'shutdown' is blocked");
    }
    if tokens.contains(&"bcdedit") {
        return Some("Command 'bcdedit' is blocked");
    }
    if lower.contains("reg delete") || lower.contains("reg.exe delete") {
        return Some("Command 'reg delete' is blocked");
    }
    None
}

#[tauri::command]
pub fn is_dangerous_command(command: String) -> bool {
    let lower = format!(" {} ", command.trim().to_lowercase());
    let dangerous_phrases = [
        "git reset --hard",
        "git clean",
        "git push",
        "invoke-webrequest",
        "npm publish",
    ];
    if dangerous_phrases.iter().any(|p| lower.contains(p)) {
        return true;
    }

    let tokens: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
        .filter(|s| !s.is_empty())
        .collect();

    ["del", "rmdir", "rd", "rm", "curl"]
        .iter()
        .any(|t| tokens.contains(t))
}

fn tail_utf8(bytes: &[u8]) -> String {
    let slice = if bytes.len() > MAX_OUTPUT_TAIL {
        &bytes[bytes.len() - MAX_OUTPUT_TAIL..]
    } else {
        bytes
    };
    String::from_utf8_lossy(slice).to_string()
}

#[tauri::command]
pub async fn run_command(
    workspace_path: String,
    command: String,
    shell: Option<String>,
    timeout_secs: Option<u64>,
) -> AppResult<CommandResult> {
    if let Some(reason) = check_blocklist(&command) {
        return Err(AppError::Blocked(reason.into()));
    }

    let root = canonical_workspace_root(&workspace_path)?;
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(120).clamp(5, 300));

    let use_ps = shell
        .as_deref()
        .map(|s| s.eq_ignore_ascii_case("powershell") || s.eq_ignore_ascii_case("pwsh"))
        .unwrap_or_else(|| {
            let trimmed = command.trim_start();
            trimmed.starts_with("Get-")
                || trimmed.starts_with("Set-")
                || trimmed.starts_with("New-")
                || trimmed.starts_with("Select-")
                || trimmed.starts_with("$")
        });

    let mut proc_cmd = if use_ps {
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command", &command]);
        c
    } else {
        let mut c = Command::new("cmd");
        c.args(["/C", &command]);
        c
    };

    proc_cmd
        .current_dir(&root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    proc_cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = proc_cmd.spawn()?;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();

    let out_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(ref mut s) = stdout {
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    });
    let err_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(ref mut s) = stderr {
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    });

    match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => {
            let out_bytes = out_task.await.unwrap_or_default();
            let err_bytes = err_task.await.unwrap_or_default();
            Ok(CommandResult {
                exit_code: status.code().unwrap_or(-1),
                stdout_tail: tail_utf8(&out_bytes),
                stderr_tail: tail_utf8(&err_bytes),
                timed_out: false,
            })
        }
        Ok(Err(e)) => Err(AppError::Io(e)),
        Err(_) => {
            let _ = child.kill().await;
            let out_bytes = out_task.await.unwrap_or_default();
            let err_bytes = err_task.await.unwrap_or_default();
            Ok(CommandResult {
                exit_code: -1,
                stdout_tail: tail_utf8(&out_bytes),
                stderr_tail: format!(
                    "{}\n[Timed out after {} s]",
                    tail_utf8(&err_bytes),
                    timeout.as_secs()
                ),
                timed_out: true,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_dangerous_system_commands() {
        assert!(check_blocklist("format C:").is_some());
        assert!(check_blocklist("diskpart").is_some());
        assert!(check_blocklist("reg delete HKLM\\Software").is_some());
        assert!(check_blocklist("shutdown /s /t 0").is_some());
        assert!(check_blocklist("rmdir /s /q C:\\").is_some());
        assert!(check_blocklist("npm test").is_none());
    }

    #[test]
    fn detects_dangerous_commands() {
        assert!(is_dangerous_command("git push origin main".into()));
        assert!(is_dangerous_command("rm -rf dist".into()));
        assert!(is_dangerous_command("curl https://example.com".into()));
        assert!(!is_dangerous_command("npm run build".into()));
    }
}
