use crate::errors::{AppError, AppResult};
use ignore::WalkBuilder;
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

pub const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    ".venv",
    "target",
    ".next",
    "__pycache__",
];

const MAX_READ_BYTES: usize = 200 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct DirEntryItem {
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadFileResult {
    pub path: String,
    pub content: String,
    pub total_lines: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct WritePreview {
    pub path: String,
    pub old_text: String,
    pub new_text: String,
    pub added: usize,
    pub removed: usize,
    pub is_new: bool,
}

fn normalize_canonical(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{stripped}"))
    } else if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

pub fn canonical_workspace_root(workspace_path: &str) -> AppResult<PathBuf> {
    let root = Path::new(workspace_path);
    if !root.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "Workspace folder not found: {workspace_path}"
        )));
    }
    let canon = fs::canonicalize(root)?;
    Ok(normalize_canonical(&canon))
}

pub fn resolve_sandbox_path(
    workspace_path: &str,
    rel_path: &str,
    must_exist: bool,
) -> AppResult<(PathBuf, PathBuf)> {
    let canon_root = canonical_workspace_root(workspace_path)?;
    let trimmed = rel_path.trim();
    if trimmed.is_empty() || trimmed == "." {
        return Ok((canon_root.clone(), canon_root));
    }

    let rel = Path::new(trimmed);
    if rel.is_absolute() {
        return Err(AppError::Blocked(
            "Absolute paths outside workspace are not allowed".into(),
        ));
    }

    let mut clean_rel = PathBuf::new();
    for comp in rel.components() {
        match comp {
            Component::Normal(seg) => clean_rel.push(seg),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::Blocked(
                    "Path traversal ('..') or external prefix is not allowed".into(),
                ));
            }
        }
    }

    let candidate = canon_root.join(&clean_rel);

    if must_exist || candidate.exists() {
        if !candidate.exists() {
            return Err(AppError::NotFound(format!("File not found: {trimmed}")));
        }
        let canon_target = normalize_canonical(&fs::canonicalize(&candidate)?);
        if !canon_target.starts_with(&canon_root) {
            return Err(AppError::Blocked(
                "Symlink escape outside workspace is not allowed".into(),
            ));
        }
        return Ok((canon_root, canon_target));
    }

    // For new files: verify nearest existing ancestor is inside workspace
    let mut ancestor = candidate.parent();
    while let Some(dir) = ancestor {
        if dir.exists() {
            let canon_anc = normalize_canonical(&fs::canonicalize(dir)?);
            if !canon_anc.starts_with(&canon_root) {
                return Err(AppError::Blocked(
                    "Target directory escapes workspace".into(),
                ));
            }
            return Ok((canon_root, candidate));
        }
        ancestor = dir.parent();
    }

    Err(AppError::Blocked("Invalid target path".into()))
}

pub fn is_ignored_dir_name(name: &str) -> bool {
    IGNORED_DIRS.iter().any(|d| d.eq_ignore_ascii_case(name))
}

fn is_probably_binary(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(8192)];
    if sample.contains(&0) {
        return true;
    }
    let non_text = sample
        .iter()
        .filter(|&&b| b < 0x09 || (b > 0x0d && b < 0x20))
        .count();
    sample.len() > 16 && non_text * 10 > sample.len() * 3
}

fn count_line_diff(old_text: &str, new_text: &str) -> (usize, usize) {
    let old_lines: Vec<&str> = old_text.lines().collect();
    let new_lines: Vec<&str> = new_text.lines().collect();
    let mut common_prefix = 0;
    while common_prefix < old_lines.len()
        && common_prefix < new_lines.len()
        && old_lines[common_prefix] == new_lines[common_prefix]
    {
        common_prefix += 1;
    }
    let mut old_end = old_lines.len();
    let mut new_end = new_lines.len();
    while old_end > common_prefix
        && new_end > common_prefix
        && old_lines[old_end - 1] == new_lines[new_end - 1]
    {
        old_end -= 1;
        new_end -= 1;
    }
    (new_end - common_prefix, old_end - common_prefix)
}

#[tauri::command]
pub fn list_dir(
    workspace_path: String,
    rel: String,
    depth: Option<usize>,
    max_entries: Option<usize>,
) -> AppResult<Vec<DirEntryItem>> {
    let (canon_root, target) = resolve_sandbox_path(&workspace_path, &rel, true)?;
    if !target.is_dir() {
        return Err(AppError::InvalidPath("Target is not a directory".into()));
    }

    let max_d = depth.unwrap_or(2).clamp(1, 5);
    let max_n = max_entries.unwrap_or(200).clamp(1, 500);
    let mut entries = Vec::new();

    let walker = WalkDir::new(&target)
        .min_depth(1)
        .max_depth(max_d)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.file_type().is_dir() && is_ignored_dir_name(&name))
        });

    for entry in walker.filter_map(Result::ok) {
        if entries.len() >= max_n {
            break;
        }
        if entry.path_is_symlink() {
            continue;
        }
        let path = entry.path();
        let Ok(rel_path) = path.strip_prefix(&canon_root) else {
            continue;
        };
        let rel_str = rel_path.to_string_lossy().replace('\\', "/");
        let is_dir = entry.file_type().is_dir();
        let size_bytes = if is_dir {
            0
        } else {
            entry.metadata().map(|m| m.len()).unwrap_or(0)
        };
        entries.push(DirEntryItem {
            path: rel_str,
            is_dir,
            size_bytes,
        });
    }

    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

#[tauri::command]
pub fn list_workspace_files(
    workspace_path: String,
    max_files: Option<usize>,
) -> AppResult<Vec<String>> {
    let canon_root = canonical_workspace_root(&workspace_path)?;
    let limit = max_files.unwrap_or(1500).clamp(50, 5000);
    let mut files = Vec::new();

    let walker = WalkBuilder::new(&canon_root)
        .hidden(false)
        .follow_links(false)
        .max_depth(Some(8))
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !(entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
                && is_ignored_dir_name(&name))
        })
        .build();

    for entry in walker.flatten() {
        if files.len() >= limit {
            break;
        }
        if entry.path_is_symlink() {
            continue;
        }
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let Ok(rel) = entry.path().strip_prefix(&canon_root) else {
            continue;
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if !rel_str.is_empty() {
            files.push(rel_str);
        }
    }

    // Sort shallowest paths first, then alphabetically so top-level & src files surface quickly
    files.sort_by(|a, b| {
        let da = a.bytes().filter(|&c| c == b'/').count();
        let db = b.bytes().filter(|&c| c == b'/').count();
        da.cmp(&db).then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
    });

    Ok(files)
}

#[tauri::command]
pub fn read_file(
    workspace_path: String,
    rel: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> AppResult<ReadFileResult> {
    let (_root, target) = resolve_sandbox_path(&workspace_path, &rel, true)?;
    if !target.is_file() {
        return Err(AppError::InvalidPath(format!("Not a file: {rel}")));
    }

    let bytes = fs::read(&target)?;
    if is_probably_binary(&bytes) {
        return Err(AppError::Blocked(format!(
            "Refused to read binary file: {rel}"
        )));
    }

    let mut truncated = false;
    let slice = if bytes.len() > MAX_READ_BYTES {
        truncated = true;
        &bytes[..MAX_READ_BYTES]
    } else {
        &bytes[..]
    };

    let full_text = String::from_utf8_lossy(slice).to_string();
    let lines: Vec<&str> = full_text.lines().collect();
    let total_lines = lines.len();

    let content = if start_line.is_some() || end_line.is_some() {
        let start = start_line.unwrap_or(1).max(1);
        let end = end_line.unwrap_or(total_lines).min(total_lines);
        if start > end || total_lines == 0 {
            String::new()
        } else {
            lines[start - 1..end].join("\n")
        }
    } else {
        full_text
    };

    Ok(ReadFileResult {
        path: rel,
        content,
        total_lines,
        truncated,
    })
}

#[tauri::command]
pub fn preview_write(
    workspace_path: String,
    rel: String,
    content: String,
) -> AppResult<WritePreview> {
    let (_root, target) = resolve_sandbox_path(&workspace_path, &rel, false)?;
    let (old_text, is_new) = if target.is_file() {
        let bytes = fs::read(&target)?;
        if is_probably_binary(&bytes) {
            return Err(AppError::Blocked("Cannot overwrite binary file".into()));
        }
        (String::from_utf8_lossy(&bytes).to_string(), false)
    } else {
        (String::new(), true)
    };

    let (added, removed) = count_line_diff(&old_text, &content);
    Ok(WritePreview {
        path: rel,
        old_text,
        new_text: content,
        added,
        removed,
        is_new,
    })
}

#[tauri::command]
pub fn preview_replace(
    workspace_path: String,
    rel: String,
    old_text: String,
    new_text: String,
) -> AppResult<WritePreview> {
    let (_root, target) = resolve_sandbox_path(&workspace_path, &rel, true)?;
    if !target.is_file() {
        return Err(AppError::InvalidPath(format!("Not a file: {rel}")));
    }
    let bytes = fs::read(&target)?;
    if is_probably_binary(&bytes) {
        return Err(AppError::Blocked("Cannot edit binary file".into()));
    }
    let current = String::from_utf8_lossy(&bytes).to_string();
    let exact_count = current.matches(&old_text).count();
    let updated = if exact_count == 1 {
        current.replacen(&old_text, &new_text, 1)
    } else if exact_count > 1 {
        return Err(AppError::InvalidPath(format!(
            "old_text matched {exact_count} times; provide more surrounding context so it matches once"
        )));
    } else {
        // Fallback: normalize CRLF <-> LF so Windows CRLF files match LLM LF edits cleanly
        let norm_current = current.replace("\r\n", "\n");
        let norm_old = old_text.replace("\r\n", "\n");
        let norm_count = norm_current.matches(&norm_old).count();
        if norm_count == 0 {
            return Err(AppError::InvalidPath(
                "old_text was not found in the file".into(),
            ));
        }
        if norm_count > 1 {
            return Err(AppError::InvalidPath(format!(
                "old_text matched {norm_count} times; provide more surrounding context so it matches once"
            )));
        }
        let norm_new = new_text.replace("\r\n", "\n");
        let replaced = norm_current.replacen(&norm_old, &norm_new, 1);
        if current.contains("\r\n") {
            replaced.replace('\n', "\r\n")
        } else {
            replaced
        }
    };

    let (added, removed) = count_line_diff(&current, &updated);
    Ok(WritePreview {
        path: rel,
        old_text: current,
        new_text: updated,
        added,
        removed,
        is_new: false,
    })
}

#[tauri::command]
pub fn apply_write(
    workspace_path: String,
    rel: String,
    content: String,
) -> AppResult<()> {
    let (_root, target) = resolve_sandbox_path(&workspace_path, &rel, false)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(target, content)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_traversal() {
        let dir = std::env::temp_dir().to_string_lossy().to_string();
        let res = resolve_sandbox_path(&dir, "../outside.txt", false);
        assert!(res.is_err());
    }

    #[test]
    fn rejects_absolute_path() {
        let dir = std::env::temp_dir().to_string_lossy().to_string();
        let res = resolve_sandbox_path(&dir, "C:\\Windows\\System32\\cmd.exe", false);
        assert!(res.is_err());
    }

    #[test]
    fn preview_write_and_unique_replace_work() {
        let root = std::env::temp_dir().join(format!("localai_fs_test_{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let root_str = root.to_string_lossy().to_string();

        let p_new = preview_write(root_str.clone(), "hello.txt".into(), "a\nb\n".into()).unwrap();
        assert!(p_new.is_new);
        assert_eq!(p_new.added, 2);

        apply_write(root_str.clone(), "hello.txt".into(), "alpha\nbeta\nalpha\n".into()).unwrap();
        let dup_err = preview_replace(
            root_str.clone(),
            "hello.txt".into(),
            "alpha".into(),
            "gamma".into(),
        );
        assert!(dup_err.is_err());

        let ok_rep = preview_replace(
            root_str.clone(),
            "hello.txt".into(),
            "beta".into(),
            "delta".into(),
        )
        .unwrap();
        assert_eq!(ok_rep.added, 1);
        assert_eq!(ok_rep.removed, 1);
        assert!(ok_rep.new_text.contains("delta"));

        // CRLF file edited with LF old_text preserves CRLF line endings
        apply_write(root_str.clone(), "win.txt".into(), "line1\r\nline2\r\nline3\r\n".into()).unwrap();
        let crlf_rep = preview_replace(
            root_str.clone(),
            "win.txt".into(),
            "line1\nline2".into(),
            "line1\nupdated2".into(),
        )
        .unwrap();
        assert_eq!(crlf_rep.new_text, "line1\r\nupdated2\r\nline3\r\n");

        // list_workspace_files returns relative paths and skips ignored dirs like node_modules
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("src/app.ts"), "export {};").unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "").unwrap();
        let listed = list_workspace_files(root_str.clone(), Some(100)).unwrap();
        assert!(listed.contains(&"hello.txt".to_string()));
        assert!(listed.contains(&"src/app.ts".to_string()));
        assert!(!listed.iter().any(|f| f.contains("node_modules")));

        let _ = fs::remove_dir_all(&root);
    }
}
