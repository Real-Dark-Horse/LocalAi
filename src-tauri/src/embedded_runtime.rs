use crate::errors::{AppError, AppResult};
use flate2::read::GzDecoder;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::Path;
use std::sync::Mutex;

const ARCHIVE_MAGIC: &[u8; 4] = b"LAIR";
const FLAG_SHARED: u8 = 0;
const FLAG_VULKAN_ONLY: u8 = 1;

static EXTRACT_LOCK: Mutex<()> = Mutex::new(());

#[cfg(feature = "embed-runtime")]
static EMBEDDED_ARCHIVE: &[u8] = include_bytes!("../embedded_runtime.bin");

#[cfg(feature = "embed-runtime")]
static EMBEDDED_STAMP: &str = include_str!("../embedded_runtime.sha");

pub fn is_embedded_build() -> bool {
    cfg!(feature = "embed-runtime")
}

fn read_exact_u8<R: Read>(r: &mut R) -> io::Result<u8> {
    let mut b = [0u8; 1];
    r.read_exact(&mut b)?;
    Ok(b[0])
}

fn read_exact_u16<R: Read>(r: &mut R) -> io::Result<u16> {
    let mut b = [0u8; 2];
    r.read_exact(&mut b)?;
    Ok(u16::from_le_bytes(b))
}

fn read_exact_u32<R: Read>(r: &mut R) -> io::Result<u32> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b)?;
    Ok(u32::from_le_bytes(b))
}

fn read_exact_u64<R: Read>(r: &mut R) -> io::Result<u64> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b)?;
    Ok(u64::from_le_bytes(b))
}

fn is_safe_filename(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && !name.contains(':')
}

/// Streams the gzipped deduplicated runtime archive directly to `runtime_dir/cpu` and `runtime_dir/vulkan`.
/// Shared files are hard-linked into `vulkan/` (falling back to copy if cross-device/FAT32) so zero disk space is wasted.
pub fn extract_archive_to_dir(
    compressed: &[u8],
    stamp: &str,
    runtime_dir: &Path,
) -> AppResult<()> {
    let _guard = EXTRACT_LOCK
        .lock()
        .map_err(|_| AppError::Server("Runtime extraction lock poisoned".into()))?;

    let clean_stamp = stamp.trim();
    let stamp_file = runtime_dir.join(".runtime_stamp");
    let cpu_dir = runtime_dir.join("cpu");
    let vk_dir = runtime_dir.join("vulkan");

    if cpu_dir.join("llama-server.exe").is_file()
        && vk_dir.join("llama-server.exe").is_file()
        && fs::read_to_string(&stamp_file)
            .map(|s| s.trim() == clean_stamp)
            .unwrap_or(false)
    {
        return Ok(());
    }

    fs::create_dir_all(&cpu_dir)?;
    fs::create_dir_all(&vk_dir)?;

    let mut decoder = GzDecoder::new(compressed);
    let mut magic = [0u8; 4];
    decoder.read_exact(&mut magic)?;
    if &magic != ARCHIVE_MAGIC {
        return Err(AppError::Server("Corrupted embedded runtime archive".into()));
    }

    let file_count = read_exact_u32(&mut decoder)?;
    for _ in 0..file_count {
        let flags = read_exact_u8(&mut decoder)?;
        let name_len = read_exact_u16(&mut decoder)? as usize;
        let mut name_buf = vec![0u8; name_len];
        decoder.read_exact(&mut name_buf)?;
        let filename = String::from_utf8(name_buf)
            .map_err(|_| AppError::Server("Invalid UTF-8 in embedded runtime".into()))?;
        if !is_safe_filename(&filename) {
            return Err(AppError::Blocked(format!(
                "Unsafe embedded runtime filename: {filename}"
            )));
        }

        let size = read_exact_u64(&mut decoder)?;

        match flags {
            FLAG_SHARED => {
                let cpu_path = cpu_dir.join(&filename);
                let mut out = File::create(&cpu_path)?;
                let mut limited = (&mut decoder).take(size);
                io::copy(&mut limited, &mut out)?;
                drop(out);

                let vk_path = vk_dir.join(&filename);
                let _ = fs::remove_file(&vk_path);
                if fs::hard_link(&cpu_path, &vk_path).is_err() {
                    fs::copy(&cpu_path, &vk_path)?;
                }
            }
            FLAG_VULKAN_ONLY => {
                let vk_path = vk_dir.join(&filename);
                let mut out = File::create(&vk_path)?;
                let mut limited = (&mut decoder).take(size);
                io::copy(&mut limited, &mut out)?;
            }
            other => {
                return Err(AppError::Server(format!(
                    "Unknown embedded runtime entry flag: {other}"
                )));
            }
        }
    }

    let tmp_stamp = runtime_dir.join(".runtime_stamp.tmp");
    fs::write(&tmp_stamp, clean_stamp)?;
    let _ = fs::remove_file(&stamp_file);
    fs::rename(&tmp_stamp, &stamp_file)?;
    Ok(())
}

#[cfg(feature = "embed-runtime")]
pub fn ensure_extracted(runtime_dir: &Path) -> AppResult<()> {
    extract_archive_to_dir(EMBEDDED_ARCHIVE, EMBEDDED_STAMP, runtime_dir)
}

#[cfg(not(feature = "embed-runtime"))]
pub fn ensure_extracted(_runtime_dir: &Path) -> AppResult<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    #[test]
    fn extracts_deduplicated_runtime_and_respects_stamp() {
        let mut raw = Vec::new();
        raw.extend_from_slice(ARCHIVE_MAGIC);
        raw.extend_from_slice(&2u32.to_le_bytes());

        // Entry 1: shared llama-server.exe
        raw.push(FLAG_SHARED);
        let n1 = b"llama-server.exe";
        raw.extend_from_slice(&(n1.len() as u16).to_le_bytes());
        raw.extend_from_slice(n1);
        let d1 = b"MZ_SHARED_SERVER";
        raw.extend_from_slice(&(d1.len() as u64).to_le_bytes());
        raw.extend_from_slice(d1);

        // Entry 2: vulkan-only ggml-vulkan.dll
        raw.push(FLAG_VULKAN_ONLY);
        let n2 = b"ggml-vulkan.dll";
        raw.extend_from_slice(&(n2.len() as u16).to_le_bytes());
        raw.extend_from_slice(n2);
        let d2 = b"MZ_VULKAN_DLL";
        raw.extend_from_slice(&(d2.len() as u64).to_le_bytes());
        raw.extend_from_slice(d2);

        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&raw).unwrap();
        let compressed = enc.finish().unwrap();

        let dir = std::env::temp_dir().join(format!("localai_embed_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        extract_archive_to_dir(&compressed, "stamp-v1", &dir).unwrap();
        assert_eq!(fs::read(dir.join("cpu/llama-server.exe")).unwrap(), d1);
        assert_eq!(fs::read(dir.join("vulkan/llama-server.exe")).unwrap(), d1);
        assert_eq!(fs::read(dir.join("vulkan/ggml-vulkan.dll")).unwrap(), d2);
        assert!(!dir.join("cpu/ggml-vulkan.dll").exists());

        // Second call hits stamp fast-path cleanly
        extract_archive_to_dir(&compressed, "stamp-v1", &dir).unwrap();

        let _ = fs::remove_dir_all(&dir);
    }
}
