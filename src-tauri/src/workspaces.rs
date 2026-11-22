use crate::errors::{AppError, AppResult};
use crate::paths::AppPaths;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub added_at: String,
    pub collapsed: bool,
    #[serde(default)]
    pub missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSummary {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub model: Option<String>,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationListPage {
    pub items: Vec<ConversationSummary>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub updated_at: String,
    pub snippet: Option<String>,
}

fn read_workspaces_file(file: &Path) -> AppResult<Vec<Workspace>> {
    if !file.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(file)?;
    let mut items: Vec<Workspace> = serde_json::from_str(&raw)?;
    for ws in &mut items {
        ws.missing = !Path::new(&ws.path).is_dir();
    }
    Ok(items)
}

fn write_workspaces_file(file: &Path, items: &[Workspace]) -> AppResult<()> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(items)?;
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, json)?;
    fs::rename(&tmp, file)?;
    Ok(())
}

fn conversation_path(paths: &AppPaths, id: &str) -> AppResult<PathBuf> {
    if id.is_empty()
        || id.contains('/')
        || id.contains('\\')
        || id.contains("..")
    {
        return Err(AppError::InvalidPath("Invalid conversation id".into()));
    }
    Ok(paths.conversations_dir.join(format!("{id}.json")))
}

#[tauri::command]
pub fn list_workspaces(paths: tauri::State<'_, AppPaths>) -> AppResult<Vec<Workspace>> {
    read_workspaces_file(&paths.workspaces_file)
}

#[tauri::command]
pub fn add_workspace(
    path: String,
    paths: tauri::State<'_, AppPaths>,
) -> AppResult<Workspace> {
    let clean = path.trim().trim_end_matches(['/', '\\']).to_string();
    let dir = Path::new(&clean);
    if !dir.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "Workspace folder does not exist: {clean}"
        )));
    }
    let mut list = read_workspaces_file(&paths.workspaces_file)?;
    if let Some(existing) = list
        .iter()
        .find(|w| w.path.eq_ignore_ascii_case(&clean))
        .cloned()
    {
        return Ok(existing);
    }

    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("workspace")
        .to_string();

    let ws = Workspace {
        id: Uuid::new_v4().to_string(),
        name,
        path: clean,
        added_at: chrono::Utc::now().to_rfc3339(),
        collapsed: false,
        missing: false,
    };
    list.insert(0, ws.clone());
    write_workspaces_file(&paths.workspaces_file, &list)?;
    Ok(ws)
}

#[tauri::command]
pub fn update_workspace(
    workspace: Workspace,
    paths: tauri::State<'_, AppPaths>,
) -> AppResult<()> {
    let mut list = read_workspaces_file(&paths.workspaces_file)?;
    for item in &mut list {
        if item.id == workspace.id {
            item.name = workspace.name;
            item.collapsed = workspace.collapsed;
            break;
        }
    }
    write_workspaces_file(&paths.workspaces_file, &list)
}

#[tauri::command]
pub fn remove_workspace(
    id: String,
    paths: tauri::State<'_, AppPaths>,
) -> AppResult<()> {
    let mut list = read_workspaces_file(&paths.workspaces_file)?;
    list.retain(|w| w.id != id);
    write_workspaces_file(&paths.workspaces_file, &list)
}

#[derive(Debug, Clone, Deserialize)]
struct ConversationHeader {
    id: Option<String>,
    workspace_id: Option<String>,
    title: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    model: Option<String>,
    mode: Option<String>,
}

fn slice_utf8_window(text: &str, center_start: usize, center_end: usize) -> String {
    let mut start = center_start.saturating_sub(30);
    while start > 0 && !text.is_char_boundary(start) {
        start -= 1;
    }
    let mut end = (center_end + 50).min(text.len());
    while end < text.len() && !text.is_char_boundary(end) {
        end += 1;
    }
    text[start..end].replace('\n', " ")
}

#[tauri::command]
pub fn list_conversations(
    workspace_id: String,
    limit: usize,
    offset: usize,
    paths: tauri::State<'_, AppPaths>,
) -> AppResult<ConversationListPage> {
    let mut summaries = Vec::new();
    if paths.conversations_dir.is_dir() {
        for entry in fs::read_dir(&paths.conversations_dir)?.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&p) else {
                continue;
            };
            // Deserialize only lightweight header fields (skips giant messages/ui_events trees)
            let Ok(hdr) = serde_json::from_str::<ConversationHeader>(&raw) else {
                continue;
            };
            if hdr.workspace_id.as_deref() != Some(workspace_id.as_str()) {
                continue;
            }
            let Some(id) = hdr.id else {
                continue;
            };
            summaries.push(ConversationSummary {
                id,
                workspace_id: workspace_id.clone(),
                title: hdr.title.unwrap_or_else(|| "New chat".to_string()),
                created_at: hdr.created_at.unwrap_or_default(),
                updated_at: hdr.updated_at.unwrap_or_default(),
                model: hdr.model,
                mode: hdr.mode.unwrap_or_else(|| "ask".to_string()),
            });
        }
    }

    summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let total = summaries.len();
    let end = (offset.saturating_add(limit)).min(total);
    let items = if offset >= total {
        Vec::new()
    } else {
        summaries[offset..end].to_vec()
    };

    Ok(ConversationListPage { items, total })
}

#[tauri::command]
pub fn load_conversation(id: String, paths: tauri::State<'_, AppPaths>) -> AppResult<Value> {
    let p = conversation_path(&paths, &id)?;
    if !p.exists() {
        return Err(AppError::NotFound(format!("Conversation {id} not found")));
    }
    let raw = fs::read_to_string(&p)?;
    let val = serde_json::from_str(&raw)?;
    Ok(val)
}

#[tauri::command]
pub fn save_conversation(conv: Value, paths: tauri::State<'_, AppPaths>) -> AppResult<()> {
    let id = conv
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Other("Missing conversation id".into()))?;
    let p = conversation_path(&paths, id)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(&conv)?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, json)?;
    fs::rename(&tmp, &p)?;
    Ok(())
}

#[tauri::command]
pub fn delete_conversation(id: String, paths: tauri::State<'_, AppPaths>) -> AppResult<()> {
    let p = conversation_path(&paths, &id)?;
    if p.exists() {
        fs::remove_file(p)?;
    }
    Ok(())
}

#[tauri::command]
pub fn rename_conversation(
    id: String,
    title: String,
    paths: tauri::State<'_, AppPaths>,
) -> AppResult<()> {
    let p = conversation_path(&paths, &id)?;
    if !p.exists() {
        return Err(AppError::NotFound(format!("Conversation {id} not found")));
    }
    let raw = fs::read_to_string(&p)?;
    let mut val: Value = serde_json::from_str(&raw)?;
    if let Some(obj) = val.as_object_mut() {
        obj.insert("title".into(), Value::String(title));
    }
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(&val)?)?;
    fs::rename(&tmp, &p)?;
    Ok(())
}

#[tauri::command]
pub fn search_conversations(
    query: String,
    paths: tauri::State<'_, AppPaths>,
) -> AppResult<Vec<SearchHit>> {
    let q = query.trim().to_lowercase();
    let mut hits = Vec::new();
    if !paths.conversations_dir.is_dir() {
        return Ok(hits);
    }

    for entry in fs::read_dir(&paths.conversations_dir)?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&p) else {
            continue;
        };
        let Ok(val) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let Some(id) = val.get("id").and_then(|v| v.as_str()).map(String::from) else {
            continue;
        };
        let title = val
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("New chat")
            .to_string();
        let workspace_id = val
            .get("workspace_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let updated_at = val
            .get("updated_at")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if q.is_empty() {
            hits.push(SearchHit {
                id,
                workspace_id,
                title,
                updated_at,
                snippet: None,
            });
            continue;
        }

        let title_match = title.to_lowercase().contains(&q);
        let mut snippet = None;
        if let Some(events) = val.get("ui_events").and_then(|v| v.as_array()) {
            for ev in events {
                if let Some(txt) = ev.get("content").and_then(|v| v.as_str()) {
                    let lower = txt.to_lowercase();
                    if let Some(pos) = lower.find(&q) {
                        snippet = Some(slice_utf8_window(txt, pos, pos + q.len()));
                        break;
                    }
                }
            }
        }

        if title_match || snippet.is_some() {
            hits.push(SearchHit {
                id,
                workspace_id,
                title,
                updated_at,
                snippet,
            });
        }
    }

    hits.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    hits.truncate(50);
    Ok(hits)
}

#[tauri::command]
pub fn open_in_explorer(path: String) -> AppResult<()> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err(AppError::NotFound(format!("Path does not exist: {path}")));
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(&path)
            .creation_flags(0x08000000)
            .spawn()?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_external_url(url: String) -> AppResult<()> {
    if !url.starts_with("https://") {
        return Err(AppError::Blocked("Only https:// URLs are allowed".into()));
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(0x08000000)
            .spawn()?;
    }
    Ok(())
}
