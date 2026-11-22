use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct AppPaths {
    pub exe_dir: PathBuf,
    pub runtime_dir: PathBuf,
    pub default_models_dir: PathBuf,
    pub data_dir: PathBuf,
    pub conversations_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub config_file: PathBuf,
    pub workspaces_file: PathBuf,
    pub app_log_file: PathBuf,
    pub server_log_file: PathBuf,
    pub using_temp_fallback: bool,
    pub fallback_warning: Option<String>,
}

impl AppPaths {
    pub fn resolve() -> Self {
        let exe_path = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
        let exe_dir = exe_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));

        let default_models_dir = exe_dir.join("models");
        let external_runtime_dir = exe_dir.join("runtime");
        let has_external_runtime = external_runtime_dir
            .join("cpu")
            .join("llama-server.exe")
            .is_file()
            || external_runtime_dir
                .join("vulkan")
                .join("llama-server.exe")
                .is_file();

        let preferred_data_dir = exe_dir.join("data");
        let local_app_base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("LocalAI");

        // In single-exe embedded builds, keep the folder containing LocalAI.exe completely clean
        // by storing runtime + data under %LOCALAPPDATA%\LocalAI\ (unless the user explicitly
        // placed a `data/` or `runtime/` folder next to LocalAI.exe for USB-portable mode).
        let use_clean_single_exe_home = crate::embedded_runtime::is_embedded_build()
            && !preferred_data_dir.is_dir()
            && !has_external_runtime;

        let (data_dir, runtime_dir, using_temp_fallback, fallback_warning) =
            if use_clean_single_exe_home {
                let d = local_app_base.join("data");
                let r = local_app_base.join("runtime");
                let _ = fs::create_dir_all(&d);
                let _ = fs::create_dir_all(&r);
                (d, r, false, None)
            } else if Self::ensure_writable_dir(&preferred_data_dir) {
                let r = if has_external_runtime || !crate::embedded_runtime::is_embedded_build() {
                    external_runtime_dir
                } else {
                    let embedded_r = preferred_data_dir.join("runtime");
                    let _ = fs::create_dir_all(&embedded_r);
                    embedded_r
                };
                (preferred_data_dir, r, false, None)
            } else {
                let fallback_data = local_app_base.join("data");
                let fallback_runtime = if has_external_runtime {
                    external_runtime_dir
                } else {
                    let r = local_app_base.join("runtime");
                    let _ = fs::create_dir_all(&r);
                    r
                };
                let _ = fs::create_dir_all(&fallback_data);
                (
                    fallback_data,
                    fallback_runtime,
                    true,
                    Some(format!(
                        "Application folder ({}) is read-only. Storing data in {}.",
                        exe_dir.display(),
                        local_app_base.display()
                    )),
                )
            };

        let conversations_dir = data_dir.join("conversations");
        let logs_dir = data_dir.join("logs");
        let _ = fs::create_dir_all(&conversations_dir);
        let _ = fs::create_dir_all(&logs_dir);

        Self {
            exe_dir,
            runtime_dir,
            default_models_dir,
            config_file: data_dir.join("config.json"),
            workspaces_file: data_dir.join("workspaces.json"),
            app_log_file: logs_dir.join("app.log"),
            server_log_file: logs_dir.join("server.log"),
            data_dir,
            conversations_dir,
            logs_dir,
            using_temp_fallback,
            fallback_warning,
        }
    }

    fn ensure_writable_dir(dir: &Path) -> bool {
        if fs::create_dir_all(dir).is_err() {
            return false;
        }
        let probe = dir.join(".localai_write_probe");
        match OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&probe)
        {
            Ok(_) => {
                let _ = fs::remove_file(&probe);
                true
            }
            Err(_) => false,
        }
    }

    pub fn append_app_log(&self, level: &str, message: &str) {
        use std::io::Write;
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.app_log_file)
        {
            let ts = chrono::Utc::now().to_rfc3339();
            let _ = writeln!(file, "[{ts}] [{level}] {message}");
        }
    }
}
