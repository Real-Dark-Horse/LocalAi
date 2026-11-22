use crate::gpu::GpuSampler;
use crate::hardware::detect_gpus_cached;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct ServerProcessStats {
    pub cpu_percent: f32,
    pub ram_mb: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PerfStats {
    pub ts: i64,
    pub cpu_percent: f32,
    pub ram_used_mb: u64,
    pub ram_total_mb: u64,
    pub gpu_percent: Option<f32>,
    pub vram_used_mb: Option<u64>,
    pub vram_total_mb: Option<u64>,
    pub server_proc: Option<ServerProcessStats>,
}

pub fn start_monitor(
    app: AppHandle,
    server_pid: Arc<Mutex<Option<u32>>>,
    interval_ms: u64,
) {
    let clamped_ms = interval_ms.clamp(500, 10_000);
    tauri::async_runtime::spawn(async move {
        let detected_gpus = tokio::task::spawn_blocking(detect_gpus_cached)
            .await
            .unwrap_or_default();
        let mut sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::everything())
                .with_memory(MemoryRefreshKind::everything()),
        );
        let sampler = GpuSampler::init(&detected_gpus);
        let mut ticker = tokio::time::interval(Duration::from_millis(clamped_ms));

        loop {
            ticker.tick().await;
            sys.refresh_cpu_usage();
            sys.refresh_memory();

            let cpu_percent = sys.global_cpu_usage();
            let ram_total_mb = sys.total_memory() / (1024 * 1024);
            let ram_used_mb = sys.used_memory() / (1024 * 1024);

            let gpu = sampler.sample();

            let tracked_pid = server_pid.lock().ok().and_then(|g| *g);
            let server_proc = tracked_pid.and_then(|pid_u32| {
                let pid = Pid::from_u32(pid_u32);
                sys.refresh_processes_specifics(
                    ProcessesToUpdate::Some(&[pid]),
                    true,
                    ProcessRefreshKind::nothing().with_cpu().with_memory(),
                );
                sys.process(pid).map(|p| ServerProcessStats {
                    cpu_percent: p.cpu_usage(),
                    ram_mb: p.memory() / (1024 * 1024),
                })
            });

            let payload = PerfStats {
                ts: chrono::Utc::now().timestamp_millis(),
                cpu_percent,
                ram_used_mb,
                ram_total_mb,
                gpu_percent: gpu.gpu_percent,
                vram_used_mb: gpu.vram_used_mb,
                vram_total_mb: gpu.vram_total_mb,
                server_proc,
            };

            let _ = app.emit("stats", payload);
        }
    });
}
