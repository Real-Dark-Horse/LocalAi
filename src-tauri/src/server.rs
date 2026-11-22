use crate::errors::{AppError, AppResult};
use crate::gpu::GpuInfo;
use crate::hardware::detect_gpus_cached;
use crate::paths::AppPaths;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerSettings {
    pub backend: String,
    pub context: u32,
    pub gpu_layers: u32,
    pub threads: u32,
    #[serde(default)]
    pub auto_gpu_layers: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ServerStatusEvent {
    Stopped,
    Loading,
    Ready { port: u16 },
    Error { message: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerNotification {
    pub level: String,
    pub message: String,
}

pub struct ServerHandle {
    pub child: Child,
    #[cfg(target_os = "windows")]
    pub job_handle: isize,
}

impl Drop for ServerHandle {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        #[cfg(target_os = "windows")]
        if self.job_handle != 0 {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.job_handle as _);
            }
            self.job_handle = 0;
        }
    }
}

pub struct ServerManager {
    pub active: Arc<Mutex<Option<ServerHandle>>>,
    pub pid_tracker: Arc<Mutex<Option<u32>>>,
    pub generation: Arc<Mutex<u64>>,
}

impl ServerManager {
    pub fn new(pid_tracker: Arc<Mutex<Option<u32>>>) -> Self {
        Self {
            active: Arc::new(Mutex::new(None)),
            pid_tracker,
            generation: Arc::new(Mutex::new(0)),
        }
    }

    pub fn stop_sync(&self) {
        if let Ok(mut gen) = self.generation.lock() {
            *gen += 1;
        }
        if let Ok(mut pid) = self.pid_tracker.lock() {
            *pid = None;
        }
        if let Ok(mut guard) = self.active.lock() {
            *guard = None;
        }
    }
}

fn find_free_port(start: u16) -> AppResult<u16> {
    for port in start..start.saturating_add(200) {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    Err(AppError::Server("No free port available from 39281".into()))
}

fn resolve_server_exe(paths: &AppPaths, backend: &str) -> Option<PathBuf> {
    // 1. Standard portable layout: <exe_dir>/runtime/<backend>/llama-server.exe
    let candidate = paths.runtime_dir.join(backend).join("llama-server.exe");
    if candidate.is_file() {
        return Some(candidate);
    }
    // 2. Bundled Tauri resources layout: <exe_dir>/resources/runtime/<backend>/llama-server.exe
    let res_candidate = paths
        .exe_dir
        .join("resources")
        .join("runtime")
        .join(backend)
        .join("llama-server.exe");
    if res_candidate.is_file() {
        return Some(res_candidate);
    }
    // 3. Flat single-directory portable layout: <exe_dir>/llama-server.exe
    let flat_candidate = paths.exe_dir.join("llama-server.exe");
    if flat_candidate.is_file() {
        return Some(flat_candidate);
    }
    // 4. Dev workspace fallback during `tauri dev` (debug builds only so release EXE is 100% standalone)
    #[cfg(debug_assertions)]
    {
        let manifest_parent = Path::new(env!("CARGO_MANIFEST_DIR")).parent();
        if let Some(root) = manifest_parent {
            let dev_candidate = root.join("runtime").join(backend).join("llama-server.exe");
            if dev_candidate.is_file() {
                return Some(dev_candidate);
            }
        }
        if let Ok(cwd) = std::env::current_dir() {
            for base in [cwd.clone(), cwd.join("..")] {
                let dev_candidate = base.join("runtime").join(backend).join("llama-server.exe");
                if dev_candidate.is_file() {
                    return Some(dev_candidate);
                }
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn attach_kill_on_close_job(child: &Child) -> isize {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return 0;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            CloseHandle(job);
            return 0;
        }
        let proc_handle = child.as_raw_handle() as _;
        if AssignProcessToJobObject(job, proc_handle) == 0 {
            CloseHandle(job);
            return 0;
        }
        job as isize
    }
}

/// Only enable conservative Vulkan shader flags up front for genuinely legacy pre-FP16 GCN AMD GPUs
/// or tiny <1.5 GB GPUs. Modern NVIDIA/AMD/Intel GPUs run full-speed Vulkan with auto fallback if needed.
pub fn needs_safe_vulkan_mode(gpus: &[GpuInfo]) -> bool {
    if gpus.is_empty() {
        return false;
    }
    let best = &gpus[0];
    let lower = best.name.to_lowercase();
    let is_legacy_amd = best.vendor.eq_ignore_ascii_case("amd")
        && (lower.contains("r5")
            || lower.contains("r7")
            || lower.contains("r9")
            || lower.contains("hd "));
    is_legacy_amd || (best.vram_total_mb > 0 && best.vram_total_mb < 1500)
}

pub fn build_llama_server_args(
    model_path: &Path,
    port: u16,
    settings: &ServerSettings,
    safe_vulkan: bool,
) -> Vec<String> {
    let mut args = vec![
        "-m".into(),
        model_path.to_string_lossy().to_string(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string(),
        "-c".into(),
        settings.context.to_string(),
        "-t".into(),
        settings.threads.to_string(),
        "-np".into(),
        "1".into(),
    ];

    if settings.backend == "vulkan" {
        if settings.auto_gpu_layers && !safe_vulkan {
            // Let llama.cpp measure real Vulkan VRAM & exact per-layer model weights automatically
            args.extend([
                "-ngl".into(),
                "auto".into(),
                "-fit".into(),
                "on".into(),
                "-fitt".into(),
                "512".into(),
                "-fitc".into(),
                "4096".into(),
            ]);
        } else {
            args.extend([
                "-ngl".into(),
                settings.gpu_layers.to_string(),
                "-fit".into(),
                "off".into(),
            ]);
        }
    } else {
        args.extend(["-ngl".into(), "0".into(), "-fit".into(), "off".into()]);
    }

    if settings.backend == "vulkan" && safe_vulkan {
        // Conservative mode for legacy/quirky Vulkan GPUs
        args.extend([
            "-b".into(),
            "512".into(),
            "-ub".into(),
            "256".into(),
            "-fa".into(),
            "off".into(),
            "-nkvo".into(),
        ]);
    } else {
        // High-throughput batching + automatic Flash Attention (safe across all architectures)
        args.extend([
            "-b".into(),
            "2048".into(),
            "-ub".into(),
            "512".into(),
            "-fa".into(),
            "auto".into(),
        ]);
    }

    // Prompt KV caching + KV prefix shifting yields 5x-20x faster multi-turn & agent steps
    args.extend([
        "--cache-prompt".into(),
        "--cache-reuse".into(),
        "256".into(),
        "--no-warmup".into(),
        "--jinja".into(),
        "--reasoning-format".into(),
        "auto".into(),
        "--no-webui".into(),
    ]);
    args
}

pub fn apply_safe_vulkan_env(cmd: &mut Command, safe_vulkan: bool) {
    if safe_vulkan {
        cmd.envs([
            ("GGML_VK_DISABLE_ASYNC", "1"),
            ("GGML_VK_DISABLE_FUSION", "1"),
            ("GGML_VK_SERIALIZE_SUBMISSIONS", "1"),
            ("GGML_VK_DISABLE_F16", "1"),
        ]);
    }
}

fn spawn_llama_server(
    exe: &Path,
    model_path: &Path,
    port: u16,
    settings: &ServerSettings,
    safe_vulkan: bool,
    log_file: &Path,
) -> AppResult<ServerHandle> {
    if let Some(parent) = log_file.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let stdout_file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(log_file)?;
    let stderr_file = stdout_file.try_clone()?;

    let args = build_llama_server_args(model_path, port, settings, safe_vulkan);

    let mut cmd = Command::new(exe);
    cmd.args(&args)
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file));
    if settings.backend == "vulkan" {
        apply_safe_vulkan_env(&mut cmd, safe_vulkan);
    }

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let child = cmd
        .spawn()
        .map_err(|e| AppError::Server(format!("Failed to launch llama-server: {e}")))?;

    #[cfg(target_os = "windows")]
    let job_handle = attach_kill_on_close_job(&child);

    Ok(ServerHandle {
        child,
        #[cfg(target_os = "windows")]
        job_handle,
    })
}

async fn check_health(port: u16) -> Option<u16> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.ok()?;
    let req = format!(
        "GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(req.as_bytes()).await.ok()?;
    let mut buf = [0u8; 256];
    let n = stream.read(&mut buf).await.ok()?;
    let head = std::str::from_utf8(&buf[..n]).ok()?;
    let status_line = head.lines().next()?;
    let code = status_line.split_whitespace().nth(1)?.parse::<u16>().ok()?;
    Some(code)
}

fn check_oom_in_log(log_file: &Path) -> bool {
    let Ok(content) = fs::read_to_string(log_file) else {
        return false;
    };
    let lower = content.to_lowercase();
    lower.contains("out of memory")
        || lower.contains("outofdevicememory")
        || lower.contains("failed to allocate")
        || lower.contains("insufficient memory")
}

fn check_fatal_model_error_in_log(log_file: &Path) -> Option<String> {
    let content = fs::read_to_string(log_file).ok()?;
    let lower = content.to_lowercase();
    if lower.contains("unknown model architecture") {
        return Some("Unsupported GGUF architecture for text chat.".into());
    }
    if lower.contains("error loading model") || lower.contains("failed to load model") {
        let detail = content
            .lines()
            .rev()
            .find(|l| {
                let s = l.to_lowercase();
                s.contains("error") || s.contains("failed")
            })
            .unwrap_or("Failed to load model file")
            .trim();
        return Some(detail.to_string());
    }
    None
}

async fn try_boot_backend(
    app: &AppHandle,
    manager: &ServerManager,
    paths: &AppPaths,
    model_path: &Path,
    settings: &ServerSettings,
    safe_vulkan: bool,
    my_gen: u64,
) -> AppResult<u16> {
    let exe = resolve_server_exe(paths, &settings.backend).ok_or_else(|| {
        AppError::NotFound(format!(
            "Missing runtime/{}/llama-server.exe",
            settings.backend
        ))
    })?;

    let port = find_free_port(39281)?;
    let handle = spawn_llama_server(
        &exe,
        model_path,
        port,
        settings,
        safe_vulkan,
        &paths.server_log_file,
    )?;
    let pid = handle.child.id();

    if let Ok(mut pid_guard) = manager.pid_tracker.lock() {
        *pid_guard = Some(pid);
    }
    if let Ok(mut active_guard) = manager.active.lock() {
        *active_guard = Some(handle);
    }

    let deadline = Instant::now() + Duration::from_secs(180);
    loop {
        if manager.generation.lock().map(|g| *g != my_gen).unwrap_or(true) {
            return Err(AppError::Server("Server start superseded".into()));
        }

        let exited = {
            let mut guard = manager
                .active
                .lock()
                .map_err(|_| AppError::Server("Server lock poisoned".into()))?;
            if let Some(ref mut h) = *guard {
                matches!(h.child.try_wait(), Ok(Some(_)))
            } else {
                true
            }
        };

        if exited {
            if check_oom_in_log(&paths.server_log_file) {
                let _ = app.emit(
                    "server-toast",
                    ServerNotification {
                        level: "warning".into(),
                        message: "Out of memory — adjusting context or GPU layers".into(),
                    },
                );
                return Err(AppError::Server("Lower context or GPU layers (OOM)".into()));
            }
            if let Some(fatal) = check_fatal_model_error_in_log(&paths.server_log_file) {
                return Err(AppError::InvalidPath(fatal));
            }
            return Err(AppError::Server(
                "llama-server exited before becoming ready".into(),
            ));
        }

        if let Some(200) = check_health(port).await {
            return Ok(port);
        }

        if Instant::now() >= deadline {
            return Err(AppError::Server("Timed out waiting for llama-server /health".into()));
        }

        tokio::time::sleep(Duration::from_millis(60)).await;
    }
}

#[tauri::command]
pub async fn start_server(
    model_path: String,
    mut settings: ServerSettings,
    app: AppHandle,
    manager: tauri::State<'_, Arc<ServerManager>>,
    paths: tauri::State<'_, AppPaths>,
) -> AppResult<u16> {
    let model = PathBuf::from(&model_path);
    if !model.is_file() {
        return Err(AppError::NotFound(format!("Model file not found: {model_path}")));
    }

    // Wait for / perform embedded runtime extraction (acquires EXTRACT_LOCK so we never race startup extraction)
    let using_external_runtime = paths.runtime_dir == paths.exe_dir.join("runtime")
        && paths
            .runtime_dir
            .join(&settings.backend)
            .join("llama-server.exe")
            .is_file();
    if crate::embedded_runtime::is_embedded_build() && !using_external_runtime {
        let rt_dir = paths.runtime_dir.clone();
        tokio::task::spawn_blocking(move || crate::embedded_runtime::ensure_extracted(&rt_dir))
            .await
            .map_err(|e| AppError::Server(format!("Runtime extraction task failed: {e}")))??;
    }

    // If Vulkan runtime isn't bundled in a minimal portable build, degrade cleanly to CPU
    if settings.backend == "vulkan" && resolve_server_exe(&paths, "vulkan").is_none() {
        settings.backend = "cpu".into();
        settings.gpu_layers = 0;
        settings.auto_gpu_layers = false;
    }

    manager.stop_sync();
    let mut my_gen = manager.generation.lock().map(|g| *g).unwrap_or(0);
    let _ = app.emit("server-status", ServerStatusEvent::Loading);

    let gpus = detect_gpus_cached();
    let initial_safe_vulkan = needs_safe_vulkan_mode(&gpus);

    let first_attempt = try_boot_backend(
        &app,
        &manager,
        &paths,
        &model,
        &settings,
        initial_safe_vulkan,
        my_gen,
    )
    .await;

    match first_attempt {
        Ok(port) => {
            let _ = app.emit("server-status", ServerStatusEvent::Ready { port });
            Ok(port)
        }
        Err(err) if settings.backend == "vulkan" && !matches!(err, AppError::InvalidPath(_)) => {
            if manager.generation.lock().map(|g| *g != my_gen).unwrap_or(true) {
                return Err(err);
            }

            let mut vulkan_candidates: Vec<(ServerSettings, bool)> = Vec::new();
            let base_ngl = settings.gpu_layers.max(4);
            let half_ngl = (base_ngl / 2).max(4);
            if !initial_safe_vulkan {
                // Retry once in safe Vulkan mode (handles older drivers / FP16 quirks while keeping GPU acceleration)
                vulkan_candidates.push((
                    ServerSettings {
                        backend: "vulkan".into(),
                        context: settings.context.min(8192),
                        gpu_layers: settings.gpu_layers.max(1),
                        threads: settings.threads,
                        auto_gpu_layers: false,
                    },
                    true,
                ));
            }
            if half_ngl < base_ngl || settings.context > 8192 {
                vulkan_candidates.push((
                    ServerSettings {
                        backend: "vulkan".into(),
                        context: settings.context.min(8192),
                        gpu_layers: half_ngl.min(base_ngl),
                        threads: settings.threads,
                        auto_gpu_layers: false,
                    },
                    true,
                ));
            }
            let min_ngl = (base_ngl / 4).max(1);
            if min_ngl < half_ngl || settings.context > 4096 {
                vulkan_candidates.push((
                    ServerSettings {
                        backend: "vulkan".into(),
                        context: settings.context.min(4096),
                        gpu_layers: min_ngl,
                        threads: settings.threads,
                        auto_gpu_layers: false,
                    },
                    true,
                ));
            }

            for (candidate, use_safe) in vulkan_candidates {
                if manager.generation.lock().map(|g| *g != my_gen).unwrap_or(true) {
                    return Err(err);
                }
                paths.append_app_log(
                    "WARN",
                    &format!(
                        "Vulkan attempt failed ({err}); retrying Vulkan (safe={use_safe}) with ngl={} ctx={}",
                        candidate.gpu_layers, candidate.context
                    ),
                );
                manager.stop_sync();
                my_gen = manager.generation.lock().map(|g| *g).unwrap_or(0);
                if let Ok(port) = try_boot_backend(
                    &app,
                    &manager,
                    &paths,
                    &model,
                    &candidate,
                    use_safe,
                    my_gen,
                )
                .await
                {
                    let _ = app.emit(
                        "server-toast",
                        ServerNotification {
                            level: "info".into(),
                            message: format!(
                                "GPU tuned to {} layers (ctx {}) to fit VRAM",
                                candidate.gpu_layers, candidate.context
                            ),
                        },
                    );
                    let _ = app.emit("server-status", ServerStatusEvent::Ready { port });
                    return Ok(port);
                }
            }

            if manager.generation.lock().map(|g| *g != my_gen).unwrap_or(true) {
                return Err(err);
            }
            paths.append_app_log("WARN", &format!("Vulkan server failed ({err}); retrying CPU"));
            manager.stop_sync();
            my_gen = manager.generation.lock().map(|g| *g).unwrap_or(0);

            let cpu_settings = ServerSettings {
                backend: "cpu".into(),
                gpu_layers: 0,
                auto_gpu_layers: false,
                ..settings
            };
            let _ = app.emit(
                "server-toast",
                ServerNotification {
                    level: "warning".into(),
                    message: "Vulkan backend failed — switched to CPU automatically".into(),
                },
            );

            match try_boot_backend(
                &app,
                &manager,
                &paths,
                &model,
                &cpu_settings,
                false,
                my_gen,
            )
            .await
            {
                Ok(port) => {
                    let _ = app.emit("server-status", ServerStatusEvent::Ready { port });
                    Ok(port)
                }
                Err(cpu_err) => {
                    if !manager.generation.lock().map(|g| *g != my_gen).unwrap_or(false) {
                        let msg = cpu_err.to_string();
                        let _ = app.emit("server-status", ServerStatusEvent::Error { message: msg });
                    }
                    Err(cpu_err)
                }
            }
        }
        Err(err) => {
            if !manager.generation.lock().map(|g| *g != my_gen).unwrap_or(false) {
                let msg = err.to_string();
                let _ = app.emit("server-status", ServerStatusEvent::Error { message: msg });
            }
            Err(err)
        }
    }
}

#[tauri::command]
pub fn stop_server(app: AppHandle, manager: tauri::State<'_, Arc<ServerManager>>) -> AppResult<()> {
    manager.stop_sync();
    let _ = app.emit("server-status", ServerStatusEvent::Stopped);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enables_safe_vulkan_only_for_legacy_gpus_and_enables_prompt_caching() {
        let r5 = vec![GpuInfo {
            name: "AMD Radeon R5 430".into(),
            vendor: "AMD".into(),
            vram_total_mb: 2048,
            vram_free_mb: 1700,
            estimated: true,
        }];
        assert!(needs_safe_vulkan_mode(&r5));

        let gtx1650 = vec![GpuInfo {
            name: "NVIDIA GeForce GTX 1650".into(),
            vendor: "NVIDIA".into(),
            vram_total_mb: 4096,
            vram_free_mb: 3600,
            estimated: false,
        }];
        assert!(!needs_safe_vulkan_mode(&gtx1650));

        let high_vram_nv = vec![GpuInfo {
            name: "NVIDIA GeForce RTX 4070".into(),
            vendor: "NVIDIA".into(),
            vram_total_mb: 12288,
            vram_free_mb: 11000,
            estimated: false,
        }];
        assert!(!needs_safe_vulkan_mode(&high_vram_nv));

        let settings = ServerSettings {
            backend: "vulkan".into(),
            context: 16384,
            gpu_layers: 11,
            threads: 6,
            auto_gpu_layers: true,
        };
        let fast_args = build_llama_server_args(Path::new("model.gguf"), 39281, &settings, false);
        assert!(fast_args.windows(2).any(|w| w == ["-ngl", "auto"]));
        assert!(fast_args.windows(2).any(|w| w == ["-fit", "on"]));
        assert!(fast_args.windows(2).any(|w| w == ["-fa", "auto"]));
        assert!(fast_args.windows(2).any(|w| w == ["-b", "2048"]));
        assert!(fast_args.contains(&"--cache-prompt".to_string()));
        assert!(fast_args.windows(2).any(|w| w == ["--cache-reuse", "256"]));
        assert!(!fast_args.contains(&"--no-cache-prompt".to_string()));
        assert!(!fast_args.contains(&"-nkvo".to_string()));

        let safe_args = build_llama_server_args(Path::new("model.gguf"), 39281, &settings, true);
        assert!(safe_args.windows(2).any(|w| w == ["-fa", "off"]));
        assert!(safe_args.contains(&"-nkvo".to_string()));
        assert!(safe_args.contains(&"--cache-prompt".to_string()));
    }
}
