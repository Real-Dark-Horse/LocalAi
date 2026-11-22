use crate::errors::AppResult;
use crate::workspace_fs::{canonical_workspace_root, is_ignored_dir_name};
use ignore::WalkBuilder;
use serde::Serialize;
use std::fs;

#[derive(Debug, Clone, Serialize)]
pub struct SearchMatch {
    pub path: String,
    pub line: usize,
    pub text: String,
}

#[tauri::command]
pub fn search_files(
    workspace_path: String,
    query: String,
    glob: Option<String>,
) -> AppResult<Vec<SearchMatch>> {
    let needle = query.trim();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let canon_root = canonical_workspace_root(&workspace_path)?;
    let needle_lower = needle.to_lowercase();
    let glob_filter = glob
        .map(|g| g.trim().trim_start_matches('*').to_lowercase())
        .filter(|g| !g.is_empty());

    let mut results = Vec::new();
    let walker = WalkBuilder::new(&canon_root)
        .hidden(false)
        .follow_links(false)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !(entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
                && is_ignored_dir_name(&name))
        })
        .build();

    for entry in walker.flatten() {
        if results.len() >= 100 {
            break;
        }
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = entry.path();
        let rel = path
            .strip_prefix(&canon_root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");

        if let Some(ref ext_or_part) = glob_filter {
            if !rel.to_lowercase().contains(ext_or_part) {
                continue;
            }
        }

        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.len() > 512 * 1024 {
            continue;
        }
        let Ok(bytes) = fs::read(path) else {
            continue;
        };
        if bytes[..bytes.len().min(4096)].contains(&0) {
            continue;
        }
        let content = String::from_utf8_lossy(&bytes);
        for (idx, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&needle_lower) {
                let clipped = if line.len() > 220 {
                    let mut end = 220;
                    while end > 0 && !line.is_char_boundary(end) {
                        end -= 1;
                    }
                    format!("{}…", &line[..end])
                } else {
                    line.to_string()
                };
                results.push(SearchMatch {
                    path: rel.clone(),
                    line: idx + 1,
                    text: clipped,
                });
                if results.len() >= 100 {
                    break;
                }
            }
        }
    }

    Ok(results)
}
