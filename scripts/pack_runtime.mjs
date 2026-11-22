import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const cpuDir = path.join(root, "runtime", "cpu");
const vkDir = path.join(root, "runtime", "vulkan");
const outBin = path.join(root, "src-tauri", "embedded_runtime.bin");
const outSha = path.join(root, "src-tauri", "embedded_runtime.sha");

const REQUIRED_EXACT = new Set([
  "llama-server.exe",
  "llama-server-impl.dll",
  "llama-common.dll",
  "llama.dll",
  "mtmd.dll",
  "ggml.dll",
  "ggml-base.dll",
  "ggml-vulkan.dll",
  "libomp.dll",
  "LICENSE-LLVM-OpenMP",
  "vcruntime140.dll",
  "vcruntime140_1.dll",
  "msvcp140.dll",
]);

const VC_REDIST_DLLS = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"];

function isRequired(name) {
  return REQUIRED_EXACT.has(name) || /^ggml-cpu-.*\.dll$/i.test(name);
}

function assertPe64(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) {
    throw new Error(`Not a valid PE binary: ${filePath}`);
  }
  const peOff = buf.readUInt32LE(0x3c);
  const machine = buf.readUInt16LE(peOff + 4);
  if (machine !== 0x8664) {
    throw new Error(`Expected x64 (0x8664) DLL, got 0x${machine.toString(16)} for ${filePath}`);
  }
}

if (!fs.existsSync(path.join(cpuDir, "llama-server.exe"))) {
  throw new Error(`Missing runtime/cpu/llama-server.exe in ${cpuDir}`);
}
if (!fs.existsSync(path.join(vkDir, "llama-server.exe"))) {
  throw new Error(`Missing runtime/vulkan/llama-server.exe in ${vkDir}`);
}

// Ensure x64 VC++ redistributable DLLs are present so LocalAI.exe has zero external runtime installs
const sys32 = path.join(process.env.SystemRoot || "C:\\Windows", "System32");
for (const dll of VC_REDIST_DLLS) {
  const cpuTarget = path.join(cpuDir, dll);
  const vkTarget = path.join(vkDir, dll);
  if (!fs.existsSync(cpuTarget)) {
    const src = path.join(sys32, dll);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing required VC++ runtime DLL: ${src}`);
    }
    assertPe64(src);
    fs.copyFileSync(src, cpuTarget);
  }
  if (!fs.existsSync(vkTarget)) {
    fs.copyFileSync(cpuTarget, vkTarget);
  }
  assertPe64(cpuTarget);
}

const cpuNames = fs.readdirSync(cpuDir).filter(isRequired).sort();
const cpuSet = new Set(cpuNames);
const vkOnlyNames = fs
  .readdirSync(vkDir)
  .filter((n) => isRequired(n) && !cpuSet.has(n))
  .sort();

const entries = [
  ...cpuNames.map((name) => ({
    flags: 0,
    name,
    data: fs.readFileSync(path.join(cpuDir, name)),
  })),
  ...vkOnlyNames.map((name) => ({
    flags: 1,
    name,
    data: fs.readFileSync(path.join(vkDir, name)),
  })),
];

const parts = [];
const header = Buffer.alloc(8);
header.write("LAIR", 0, 4, "ascii");
header.writeUInt32LE(entries.length, 4);
parts.push(header);

let rawTotal = 0;
for (const entry of entries) {
  const nameBuf = Buffer.from(entry.name, "utf8");
  const meta = Buffer.alloc(1 + 2 + nameBuf.length + 8);
  meta.writeUInt8(entry.flags, 0);
  meta.writeUInt16LE(nameBuf.length, 1);
  nameBuf.copy(meta, 3);
  meta.writeBigUInt64LE(BigInt(entry.data.length), 3 + nameBuf.length);
  parts.push(meta, entry.data);
  rawTotal += entry.data.length;
}

const uncompressed = Buffer.concat(parts);
const compressed = zlib.gzipSync(uncompressed, { level: 9 });
const sha = crypto.createHash("sha256").update(compressed).digest("hex").slice(0, 16);

fs.writeFileSync(outBin, compressed);
fs.writeFileSync(outSha, sha, "utf8");

console.log(
  `Packed ${entries.length} runtime files (${cpuNames.length} shared + ${vkOnlyNames.length} vulkan-only): ` +
    `${(rawTotal / 1048576).toFixed(2)} MB raw -> ${(compressed.length / 1048576).toFixed(2)} MB gzip (stamp ${sha})`
);
