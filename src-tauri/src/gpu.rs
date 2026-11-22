use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub name: String,
    pub vendor: String,
    pub vram_total_mb: u64,
    pub vram_free_mb: u64,
    pub estimated: bool,
}

#[derive(Debug, Clone, Default)]
pub struct GpuSample {
    pub gpu_percent: Option<f32>,
    pub vram_used_mb: Option<u64>,
    pub vram_total_mb: Option<u64>,
}

pub fn detect_gpus() -> Vec<GpuInfo> {
    if let Some(nvml_gpus) = detect_nvidia_nvml() {
        if !nvml_gpus.is_empty() {
            return nvml_gpus;
        }
    }
    detect_gpus_wmi()
}

fn detect_nvidia_nvml() -> Option<Vec<GpuInfo>> {
    let nvml = nvml_wrapper::Nvml::init().ok()?;
    let count = nvml.device_count().ok()?;
    let mut gpus = Vec::new();
    for idx in 0..count {
        if let Ok(dev) = nvml.device_by_index(idx) {
            let name = dev.name().unwrap_or_else(|_| format!("NVIDIA GPU {idx}"));
            let mem = dev.memory_info().ok();
            let vram_total_mb = mem.as_ref().map(|m| m.total / (1024 * 1024)).unwrap_or(0);
            let vram_free_mb = mem.as_ref().map(|m| m.free / (1024 * 1024)).unwrap_or(0);
            gpus.push(GpuInfo {
                name,
                vendor: "NVIDIA".to_string(),
                vram_total_mb,
                vram_free_mb,
                estimated: false,
            });
        }
    }
    gpus.sort_by(|a, b| b.vram_total_mb.cmp(&a.vram_total_mb));
    Some(gpus)
}

#[cfg(target_os = "windows")]
fn detect_gpus_wmi() -> Vec<GpuInfo> {
    // Query both WMI and the 64-bit registry HardwareInformation.qwMemorySize so
    // AMD/Intel GPUs with >4 GB VRAM report their true memory instead of the 32-bit WMI 4 GB cap.
    let ps_script = r#"
      $ErrorActionPreference = 'SilentlyContinue'
      $regMem = @{}
      Get-ItemProperty -Path 'HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*' | ForEach-Object {
        $desc = $_.DriverDesc
        $qw = $_.'HardwareInformation.qwMemorySize'
        if ($desc -and $qw) {
          $mb = [math]::Round(([double]$qw) / 1MB)
          if ($mb -gt 0 -and (!$regMem.ContainsKey($desc) -or $mb -gt $regMem[$desc])) {
            $regMem[$desc] = $mb
          }
        }
      }
      Get-CimInstance Win32_VideoController | ForEach-Object {
        $name = $_.Name
        $wmiMb = if ($_.AdapterRAM) { [math]::Round(([double]$_.AdapterRAM) / 1MB) } else { 0 }
        $mb = if ($name -and $regMem.ContainsKey($name) -and $regMem[$name] -gt $wmiMb) { $regMem[$name] } else { $wmiMb }
        "$name|$($_.AdapterCompatibility)|$mb"
      }
    "#;
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", ps_script])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let Ok(output) = cmd.output() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut out = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.trim().split('|').collect();
        if parts.len() < 3 {
            continue;
        }
        let name = parts[0].trim();
        let lower_name = name.to_lowercase();
        if name.is_empty()
            || lower_name.contains("microsoft basic")
            || lower_name.contains("virtual display")
            || lower_name.contains("parsec")
        {
            continue;
        }
        let compat = parts[1].trim().to_lowercase();
        let vendor = if compat.contains("nvidia") || lower_name.contains("nvidia") {
            "NVIDIA"
        } else if compat.contains("amd")
            || compat.contains("ati")
            || lower_name.contains("radeon")
        {
            "AMD"
        } else if compat.contains("intel") || lower_name.contains("intel") {
            "Intel"
        } else {
            "Other"
        };
        let vram_total_mb = parts[2].trim().parse::<u64>().unwrap_or(0);
        let vram_free_mb = (vram_total_mb as f64 * 0.85) as u64;
        out.push(GpuInfo {
            name: name.to_string(),
            vendor: vendor.to_string(),
            vram_total_mb,
            vram_free_mb,
            estimated: true,
        });
    }
    // Prefer discrete GPUs with larger VRAM over integrated graphics
    out.sort_by(|a, b| {
        let a_dedicated = !a.name.to_lowercase().contains("uhd")
            && !a.name.to_lowercase().contains("iris")
            && !a.name.to_lowercase().contains("hd graphics");
        let b_dedicated = !b.name.to_lowercase().contains("uhd")
            && !b.name.to_lowercase().contains("iris")
            && !b.name.to_lowercase().contains("hd graphics");
        b_dedicated
            .cmp(&a_dedicated)
            .then_with(|| b.vram_total_mb.cmp(&a.vram_total_mb))
    });
    out
}

#[cfg(not(target_os = "windows"))]
fn detect_gpus_wmi() -> Vec<GpuInfo> {
    Vec::new()
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
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            CloseHandle(job);
            return 0;
        }
        if AssignProcessToJobObject(job, child.as_raw_handle() as _) == 0 {
            CloseHandle(job);
            return 0;
        }
        job as isize
    }
}

pub enum GpuSampler {
    Nvml {
        nvml: nvml_wrapper::Nvml,
    },
    PowerShell {
        latest: Arc<Mutex<GpuSample>>,
        _child: Option<Child>,
        #[cfg(target_os = "windows")]
        job_handle: isize,
    },
    None,
}

impl GpuSampler {
    pub fn init(detected_gpus: &[GpuInfo]) -> Self {
        if let Ok(nvml) = nvml_wrapper::Nvml::init() {
            if nvml.device_count().unwrap_or(0) > 0 {
                return Self::Nvml { nvml };
            }
        }

        if detected_gpus.is_empty() {
            return Self::None;
        }

        #[cfg(target_os = "windows")]
        {
            let total_vram_mb = detected_gpus.iter().map(|g| g.vram_total_mb).max();
            let latest = Arc::new(Mutex::new(GpuSample {
                gpu_percent: None,
                vram_used_mb: None,
                vram_total_mb: total_vram_mb,
            }));
            let (child, job_handle) = spawn_ps_gpu_sampler(Arc::clone(&latest), total_vram_mb);
            Self::PowerShell {
                latest,
                _child: child,
                job_handle,
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            Self::None
        }
    }

    pub fn sample(&self) -> GpuSample {
        match self {
            Self::Nvml { nvml } => {
                let Ok(dev) = nvml.device_by_index(0) else {
                    return GpuSample::default();
                };
                let gpu_percent = dev.utilization_rates().ok().map(|u| u.gpu as f32);
                let mem = dev.memory_info().ok();
                GpuSample {
                    gpu_percent,
                    vram_used_mb: mem.as_ref().map(|m| m.used / (1024 * 1024)),
                    vram_total_mb: mem.as_ref().map(|m| m.total / (1024 * 1024)),
                }
            }
            Self::PowerShell { latest, .. } => latest
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default(),
            Self::None => GpuSample::default(),
        }
    }
}

impl Drop for GpuSampler {
    fn drop(&mut self) {
        if let Self::PowerShell {
            _child: Some(child),
            #[cfg(target_os = "windows")]
            job_handle,
            ..
        } = self
        {
            let _ = child.kill();
            let _ = child.wait();
            #[cfg(target_os = "windows")]
            if *job_handle != 0 {
                unsafe {
                    windows_sys::Win32::Foundation::CloseHandle(*job_handle as _);
                }
                *job_handle = 0;
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn spawn_ps_gpu_sampler(
    latest: Arc<Mutex<GpuSample>>,
    total_vram_mb: Option<u64>,
) -> (Option<Child>, isize) {
    use std::io::{BufRead, BufReader};

    // Single batched Get-Counter call every 3s keeps background CPU usage negligible during inference.
    let ps_loop = r#"
      $ErrorActionPreference = 'SilentlyContinue'
      $counters = @(
        '\GPU Engine(*engtype_3D)\Utilization Percentage',
        '\GPU Engine(*engtype_compute*)\Utilization Percentage',
        '\GPU Adapter Memory(*)\Dedicated Usage'
      )
      while ($true) {
        $samples = (Get-Counter -Counter $counters).CounterSamples
        $s3d = 0.0; $scomp = 0.0; $mem = 0.0; $hasGpu = $false; $hasMem = $false
        foreach ($s in $samples) {
          $p = $s.Path.ToLowerInvariant()
          if ($p.Contains('engtype_3d')) { $s3d += [double]$s.CookedValue; $hasGpu = $true }
          elseif ($p.Contains('engtype_compute')) { $scomp += [double]$s.CookedValue; $hasGpu = $true }
          elseif ($p.Contains('dedicated usage')) { $mem += [double]$s.CookedValue; $hasMem = $true }
        }
        $gpuPct = if ($hasGpu) { [math]::Min(100, [math]::Round([math]::Max($s3d, $scomp), 1)) } else { '' }
        $vramMb = if ($hasMem) { [math]::Round($mem / 1MB) } else { '' }
        Write-Output "$gpuPct|$vramMb"
        [Console]::Out.Flush()
        Start-Sleep -Seconds 3
      }
    "#;

    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", ps_loop])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let Ok(mut child) = cmd.spawn() else {
        return (None, 0);
    };
    let job_handle = attach_kill_on_close_job(&child);
    let Some(stdout) = child.stdout.take() else {
        return (Some(child), job_handle);
    };

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let parts: Vec<&str> = line.trim().split('|').collect();
            if parts.len() != 2 {
                continue;
            }
            let gpu_percent = parts[0].trim().parse::<f32>().ok();
            let vram_used_mb = parts[1].trim().parse::<u64>().ok();
            if let Ok(mut guard) = latest.lock() {
                guard.gpu_percent = gpu_percent;
                guard.vram_used_mb = vram_used_mb;
                guard.vram_total_mb = total_vram_mb;
            }
        }
    });

    (Some(child), job_handle)
}
