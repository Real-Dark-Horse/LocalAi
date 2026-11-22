use crate::errors::AppResult;
use crate::paths::AppPaths;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelOverride {
    #[serde(default)]
    pub backend: Option<String>,
    pub context: u32,
    pub gpu_layers: u32,
    pub threads: u32,
    pub temperature: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub version: u32,
    pub models_dir: String,
    pub last_model: Option<String>,
    pub last_workspace_id: Option<String>,
    pub last_conversation_id: Option<String>,
    pub default_mode: String,
    pub sidebar_collapsed: bool,
    pub model_overrides: HashMap<String, ModelOverride>,
    pub monitor_interval_ms: u64,
    pub font_size: u8,
    pub verbose_steps: bool,
    pub default_thinking: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: 2,
            models_dir: String::new(),
            last_model: None,
            last_workspace_id: None,
            last_conversation_id: None,
            default_mode: "ask".to_string(),
            sidebar_collapsed: false,
            model_overrides: HashMap::new(),
            monitor_interval_ms: 1500,
            font_size: 14,
            verbose_steps: false,
            default_thinking: false,
        }
    }
}

pub struct ConfigState(pub Mutex<AppConfig>);

impl AppConfig {
    pub fn load_or_init(paths: &AppPaths) -> AppResult<Self> {
        if paths.config_file.exists() {
            let raw = fs::read_to_string(&paths.config_file)?;
            if let Ok(mut cfg) = serde_json::from_str::<AppConfig>(&raw) {
                if cfg.version == 0 {
                    cfg.version = 2;
                }
                // Portable recovery: if the saved models_dir no longer exists (e.g. USB drive letter changed
                // or folder was moved to another machine), automatically switch to <exe_dir>/models if present.
                let models_dir_missing = cfg.models_dir.trim().is_empty()
                    || !std::path::Path::new(&cfg.models_dir).is_dir();
                if models_dir_missing && paths.default_models_dir.is_dir() {
                    cfg.models_dir = paths.default_models_dir.to_string_lossy().to_string();
                    let _ = cfg.save(paths);
                }
                return Ok(cfg);
            }
        }

        let mut cfg = Self::default();
        if paths.default_models_dir.is_dir() {
            cfg.models_dir = paths.default_models_dir.to_string_lossy().to_string();
        }
        cfg.save(paths)?;
        Ok(cfg)
    }

    pub fn save(&self, paths: &AppPaths) -> AppResult<()> {
        if let Some(parent) = paths.config_file.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self)?;
        let tmp = paths.config_file.with_extension("json.tmp");
        fs::write(&tmp, json)?;
        fs::rename(&tmp, &paths.config_file)?;
        Ok(())
    }
}

#[tauri::command]
pub fn get_paths(paths: tauri::State<'_, AppPaths>) -> AppPaths {
    paths.inner().clone()
}

#[tauri::command]
pub fn get_config(state: tauri::State<'_, ConfigState>) -> AppResult<AppConfig> {
    let guard = state
        .0
        .lock()
        .map_err(|_| crate::errors::AppError::Other("Config lock poisoned".into()))?;
    Ok(guard.clone())
}

#[tauri::command]
pub fn save_config(
    config: AppConfig,
    state: tauri::State<'_, ConfigState>,
    paths: tauri::State<'_, AppPaths>,
) -> AppResult<AppConfig> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| crate::errors::AppError::Other("Config lock poisoned".into()))?;
    config.save(&paths)?;
    *guard = config.clone();
    Ok(config)
}
