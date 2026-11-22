use crate::gpu::{detect_gpus, GpuInfo};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use sysinfo::{MemoryRefreshKind, RefreshKind, System};

static GPU_CACHE: OnceLock<Vec<GpuInfo>> = OnceLock::new();

pub fn detect_gpus_cached() -> Vec<GpuInfo> {
    GPU_CACHE.get_or_init(detect_gpus).clone()
}

pub fn warm_hardware_cache() {
    if GPU_CACHE.get().is_none() {
        std::thread::spawn(|| {
            let _ = detect_gpus_cached();
        });
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub cpu_name: String,
    pub physical_cores: usize,
    pub logical_cores: usize,
    pub total_ram_mb: u64,
    pub available_ram_mb: u64,
    pub gpus: Vec<GpuInfo>,
    pub recommended_backend: String,
}

pub fn detect_hardware_info() -> HardwareInfo {
    let mut sys = System::new_with_specifics(
        RefreshKind::nothing()
            .with_memory(MemoryRefreshKind::everything())
            .with_cpu(sysinfo::CpuRefreshKind::nothing()),
    );
    sys.refresh_memory();
    sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());

    let cpu_name = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown CPU".to_string());

    let logical_cores = sys.cpus().len().max(1);
    let physical_cores = sys.physical_core_count().unwrap_or(logical_cores).max(1);
    let total_ram_mb = sys.total_memory() / (1024 * 1024);
    let available_ram_mb = sys.available_memory() / (1024 * 1024);

    let gpus = detect_gpus_cached();
    let has_capable_gpu = gpus.iter().any(|g| g.vram_total_mb >= 1500);
    let recommended_backend = if has_capable_gpu {
        "vulkan".to_string()
    } else {
        "cpu".to_string()
    };

    HardwareInfo {
        cpu_name,
        physical_cores,
        logical_cores,
        total_ram_mb,
        available_ram_mb,
        gpus,
        recommended_backend,
    }
}

#[tauri::command]
pub fn detect_hardware() -> HardwareInfo {
    detect_hardware_info()
}
