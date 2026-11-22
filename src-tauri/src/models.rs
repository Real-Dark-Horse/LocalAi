use crate::errors::{AppError, AppResult};
use crate::hardware::detect_hardware_info;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelAutoSettings {
    pub backend: String,
    pub threads: u32,
    pub gpu_layers: u32,
    pub context: u32,
    pub temperature: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub filename: String,
    pub path: String,
    pub size_mb: u64,
    pub quantization: Option<String>,
    #[serde(default)]
    pub architecture: Option<String>,
    #[serde(default)]
    pub max_context: Option<u32>,
    #[serde(default)]
    pub layer_count: Option<u32>,
    pub auto_settings: ModelAutoSettings,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct GgufMeta {
    pub architecture: Option<String>,
    pub max_context: Option<u32>,
    pub layer_count: Option<u32>,
}

fn read_u32_le(bytes: &[u8], off: &mut usize) -> Option<u32> {
    if *off + 4 > bytes.len() {
        return None;
    }
    let v = u32::from_le_bytes(bytes[*off..*off + 4].try_into().ok()?);
    *off += 4;
    Some(v)
}

fn read_u64_le(bytes: &[u8], off: &mut usize) -> Option<u64> {
    if *off + 8 > bytes.len() {
        return None;
    }
    let v = u64::from_le_bytes(bytes[*off..*off + 8].try_into().ok()?);
    *off += 8;
    Some(v)
}

fn read_gguf_string<'a>(bytes: &'a [u8], off: &mut usize) -> Option<&'a str> {
    let len = read_u64_le(bytes, off)? as usize;
    if len > 8192 || *off + len > bytes.len() {
        return None;
    }
    let s = std::str::from_utf8(&bytes[*off..*off + len]).ok()?;
    *off += len;
    Some(s)
}

fn read_gguf_uint(bytes: &[u8], off: &mut usize, vtype: u32) -> Option<u32> {
    match vtype {
        4 | 5 => read_u32_le(bytes, off),
        10 | 11 => read_u64_le(bytes, off).map(|v| v.min(u32::MAX as u64) as u32),
        _ => None,
    }
}

fn gguf_scalar_size(vtype: u32) -> Option<usize> {
    match vtype {
        0 | 1 | 7 => Some(1),
        2 | 3 => Some(2),
        4 | 5 | 6 => Some(4),
        10 | 11 | 12 => Some(8),
        _ => None,
    }
}

fn skip_gguf_value(bytes: &[u8], off: &mut usize, vtype: u32) -> Option<()> {
    if let Some(sz) = gguf_scalar_size(vtype) {
        if *off + sz > bytes.len() {
            return None;
        }
        *off += sz;
        return Some(());
    }
    match vtype {
        8 => {
            let _ = read_gguf_string(bytes, off)?;
            Some(())
        }
        9 => {
            let elem_type = read_u32_le(bytes, off)?;
            let count = read_u64_le(bytes, off)? as usize;
            if let Some(elem_sz) = gguf_scalar_size(elem_type) {
                let total = count.checked_mul(elem_sz)?;
                if *off + total > bytes.len() {
                    return None;
                }
                *off += total;
                return Some(());
            }
            if count > 4096 {
                return None;
            }
            for _ in 0..count {
                skip_gguf_value(bytes, off, elem_type)?;
            }
            Some(())
        }
        _ => None,
    }
}

pub fn parse_gguf_meta_bytes(buf: &[u8]) -> GgufMeta {
    let mut meta = GgufMeta::default();
    if buf.len() < 24 || &buf[0..4] != b"GGUF" {
        return meta;
    }
    let mut off = 4usize;
    let version = read_u32_le(buf, &mut off).unwrap_or(0);
    if !matches!(version, 2 | 3) {
        return meta;
    }
    let _tensor_count = read_u64_le(buf, &mut off).unwrap_or(0);
    let kv_count = read_u64_le(buf, &mut off).unwrap_or(0).min(256);

    for _ in 0..kv_count {
        let Some(key) = read_gguf_string(buf, &mut off) else {
            break;
        };
        let Some(vtype) = read_u32_le(buf, &mut off) else {
            break;
        };

        if key == "general.architecture" && vtype == 8 {
            if let Some(arch) = read_gguf_string(buf, &mut off) {
                meta.architecture = Some(arch.to_lowercase());
                continue;
            }
            break;
        }

        if key.ends_with(".context_length") {
            if let Some(val) = read_gguf_uint(buf, &mut off, vtype) {
                if val > 0 {
                    meta.max_context = Some(val);
                }
                continue;
            }
        }

        if key.ends_with(".block_count") {
            if let Some(val) = read_gguf_uint(buf, &mut off, vtype) {
                if val > 0 {
                    meta.layer_count = Some(val);
                }
                continue;
            }
        }

        if skip_gguf_value(buf, &mut off, vtype).is_none() {
            break;
        }
    }

    meta
}

pub fn read_gguf_meta(path: &Path) -> GgufMeta {
    let Ok(mut file) = File::open(path) else {
        return GgufMeta::default();
    };
    let mut buf = vec![0u8; 65536];
    let n = file.read(&mut buf).unwrap_or(0);
    parse_gguf_meta_bytes(&buf[..n])
}

fn is_non_chat_gguf(filename: &str, meta: &GgufMeta) -> bool {
    let lower = filename.to_lowercase();
    if lower.contains("mmproj") || lower.contains("projector") {
        return true;
    }
    if let Some(arch) = meta.architecture.as_deref() {
        return matches!(
            arch,
            "clip"
                | "flux"
                | "sdxl"
                | "sd1"
                | "sd2"
                | "sd3"
                | "wan"
                | "cosmos"
                | "anima"
                | "chroma"
                | "ltx"
                | "qwen_image"
                | "z_image"
        );
    }
    false
}

pub fn extract_quantization(filename: &str) -> Option<String> {
    let upper = filename.to_uppercase();
    let known = [
        "Q8_0", "Q6_K", "Q5_K_M", "Q5_K_S", "Q5_0", "Q4_K_M", "Q4_K_S", "Q4_0", "Q3_K_M",
        "Q3_K_S", "Q2_K", "IQ4_XS", "IQ4_NL", "IQ3_XXS", "IQ3_M", "IQ2_XS", "MXFP4", "F16",
        "BF16",
    ];
    for q in known {
        if upper.contains(q) {
            return Some(q.to_string());
        }
    }
    None
}

pub fn format_model_name(filename: &str, quant: Option<&str>) -> String {
    let mut stem = filename.to_string();
    for ext in [".gguf", ".GGUF"] {
        if let Some(s) = stem.strip_suffix(ext) {
            stem = s.to_string();
            break;
        }
    }
    if let Some(q) = quant {
        let lower_q = q.to_lowercase();
        if let Some(idx) = stem.to_lowercase().rfind(&lower_q) {
            let trimmed = stem[..idx].trim_end_matches(['-', '_', '.']);
            if !trimmed.is_empty() {
                stem = trimmed.to_string();
            }
        }
    }
    stem.replace(['_', '.'], "-")
}

pub fn is_small_model(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    let tokens: Vec<&str> = lower.split(['-', '_', '.', ' ']).collect();
    tokens
        .iter()
        .any(|t| matches!(*t, "0.5b" | "0.6b" | "1b" | "1.5b" | "1.7b" | "2b" | "3b"))
}

pub fn compute_auto_settings(
    filename: &str,
    model_mb: u64,
    physical_cores: usize,
    available_ram_mb: u64,
    vram_free_mb: Option<u64>,
    max_context: Option<u32>,
    layer_count: Option<u32>,
) -> (ModelAutoSettings, Vec<String>) {
    let threads = (physical_cores as u32).clamp(1, 32);
    let capable_vram = vram_free_mb.filter(|&v| v >= 1500);
    let backend = if capable_vram.is_some() {
        "vulkan".to_string()
    } else {
        "cpu".to_string()
    };

    let total_layers = layer_count.unwrap_or(32).max(1);
    let gpu_layers = match capable_vram {
        None => 0,
        Some(vram_free) => {
            // Reserve headroom for Vulkan compute buffers, KV cache, and compositor
            let reserve = if vram_free <= 4096 { 650 } else { 550 };
            let usable = vram_free as i64 - reserve;
            if usable <= 0 || model_mb == 0 {
                0
            } else if (usable as f64) >= (model_mb as f64) * 1.15 {
                99
            } else {
                let est = ((total_layers as f64 * (usable as f64)) / (model_mb as f64)).floor() as i32;
                est.clamp(1, 99) as u32
            }
        }
    };

    let ram_headroom = (available_ram_mb as i64) - (model_mb as i64);
    let mut context = if ram_headroom > 10000
        && (capable_vram.map(|v| v >= 10000).unwrap_or(false) || available_ram_mb >= 20000)
    {
        32768
    } else if ram_headroom > 3000 || capable_vram.map(|v| v >= 6000).unwrap_or(false) {
        16384
    } else {
        8192
    };
    if let Some(vram_free) = capable_vram {
        if vram_free <= 3000 && model_mb > 1800 && context > 8192 {
            context = 8192;
        }
    }
    if let Some(native_ctx) = max_context {
        if native_ctx >= 1024 && context > native_ctx {
            context = native_ctx;
        }
    }

    let mut warnings = Vec::new();
    if (model_mb as f64) > (available_ram_mb as f64) * 0.85
        && capable_vram.map(|v| (model_mb as f64) > (v as f64) * 0.9).unwrap_or(true)
    {
        warnings.push("This model may be too large for your available memory".to_string());
    }
    if is_small_model(filename) {
        warnings.push("Small models are unreliable in Auto mode".to_string());
    }

    (
        ModelAutoSettings {
            backend,
            threads,
            gpu_layers,
            context,
            temperature: 0.2,
        },
        warnings,
    )
}

#[tauri::command]
pub fn scan_models(models_dir: String) -> AppResult<Vec<ModelInfo>> {
    let trimmed = models_dir.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let root = Path::new(trimmed);
    if !root.exists() || !root.is_dir() {
        return Err(AppError::NotFound(format!(
            "Models directory does not exist: {trimmed}"
        )));
    }

    let hw = detect_hardware_info();
    let best_vram_free = hw
        .gpus
        .iter()
        .filter(|g| g.vram_total_mb >= 1500)
        .map(|g| g.vram_free_mb.max((g.vram_total_mb as f64 * 0.8) as u64))
        .max();

    let mut models = Vec::new();
    for entry in WalkDir::new(root)
        .max_depth(3)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if !ext.eq_ignore_ascii_case("gguf") {
            continue;
        }

        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("model.gguf")
            .to_string();

        // Skip secondary split GGUF shards (keep -00001-of- or non-split files)
        let lower = filename.to_lowercase();
        if lower.contains("-of-") && !lower.contains("-00001-of-") {
            continue;
        }

        let meta = read_gguf_meta(path);
        if is_non_chat_gguf(&filename, &meta) {
            continue;
        }

        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let size_mb = (size_bytes / (1024 * 1024)).max(1);

        let quant = extract_quantization(&filename);
        let name = format_model_name(&filename, quant.as_deref());

        let (auto_settings, warnings) = compute_auto_settings(
            &filename,
            size_mb,
            hw.physical_cores,
            hw.available_ram_mb,
            best_vram_free,
            meta.max_context,
            meta.layer_count,
        );

        models.push(ModelInfo {
            name,
            filename,
            path: path.to_string_lossy().to_string(),
            size_mb,
            quantization: quant,
            architecture: meta.architecture,
            max_context: meta.max_context,
            layer_count: meta.layer_count,
            auto_settings,
            warnings,
        });
    }

    models.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_settings_vulkan_and_ram_tiers() {
        let (s, w) = compute_auto_settings(
            "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
            4400,
            6,
            9000,
            Some(1700),
            Some(32768),
            Some(28),
        );
        assert_eq!(s.backend, "vulkan");
        assert_eq!(s.threads, 6);
        assert!(s.gpu_layers > 0 && s.gpu_layers < 99);
        assert_eq!(s.context, 8192);
        assert!(w.is_empty());

        let (s_large_gpu, _) = compute_auto_settings(
            "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
            4400,
            6,
            9000,
            Some(6000),
            Some(32768),
            Some(28),
        );
        assert_eq!(s_large_gpu.context, 16384);

        // Native model context cap is respected
        let (s_small_ctx, _) = compute_auto_settings(
            "codellama-7b-q4_k_m.gguf",
            4000,
            8,
            16000,
            Some(8000),
            Some(4096),
            Some(32),
        );
        assert_eq!(s_small_ctx.context, 4096);
    }

    #[test]
    fn warns_on_small_model_and_low_ram() {
        let (s, w) = compute_auto_settings(
            "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
            2200,
            4,
            2400,
            None,
            None,
            None,
        );
        assert_eq!(s.backend, "cpu");
        assert_eq!(s.gpu_layers, 0);
        assert_eq!(s.context, 8192);
        assert_eq!(w.len(), 2);
        assert!(!is_small_model("qwen2.5-14b-instruct.gguf"));
    }

    #[test]
    fn parses_gguf_architecture_context_and_layers() {
        let mut gguf = Vec::new();
        gguf.extend_from_slice(b"GGUF");
        gguf.extend_from_slice(&3u32.to_le_bytes());
        gguf.extend_from_slice(&0u64.to_le_bytes());
        gguf.extend_from_slice(&3u64.to_le_bytes());

        let push_str = |buf: &mut Vec<u8>, s: &str| {
            buf.extend_from_slice(&(s.len() as u64).to_le_bytes());
            buf.extend_from_slice(s.as_bytes());
        };

        push_str(&mut gguf, "general.architecture");
        gguf.extend_from_slice(&8u32.to_le_bytes());
        push_str(&mut gguf, "qwen3");

        push_str(&mut gguf, "qwen3.context_length");
        gguf.extend_from_slice(&4u32.to_le_bytes());
        gguf.extend_from_slice(&40960u32.to_le_bytes());

        push_str(&mut gguf, "qwen3.block_count");
        gguf.extend_from_slice(&4u32.to_le_bytes());
        gguf.extend_from_slice(&36u32.to_le_bytes());

        let meta = parse_gguf_meta_bytes(&gguf);
        assert_eq!(meta.architecture.as_deref(), Some("qwen3"));
        assert_eq!(meta.max_context, Some(40960));
        assert_eq!(meta.layer_count, Some(36));
        assert!(!is_non_chat_gguf("Qwen3-8B-Q4_K_M.gguf", &meta));
        assert!(is_non_chat_gguf("mmproj-model-f16.gguf", &meta));
    }
}
