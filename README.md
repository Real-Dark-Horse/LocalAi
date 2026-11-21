# LocalAI

**Your models. Your project. Your private offline AI chat & coding agent.**

LocalAI is a lightweight Windows desktop app built with **Tauri v2**, **React**, **TypeScript**, and **Rust**, powered by an embedded **`llama.cpp` (`llama-server`)** runtime (CPU + Vulkan GPU). Everything runs 100% locally using your own `.gguf` models—no cloud APIs, telemetry, or external runtime installers required.

## Features

- **Three Execution Modes**
  - **Chat**: General-purpose offline conversations without needing a project folder.
  - **Ask**: Coding agent with workspace tools (`list_dir`, `read_file`, `search_files`, `write_file`, `replace_in_file`, `run_command`). Shows diff previews and asks approval before edits or commands.
  - **Auto**: Autonomous coding mode—reads and edits files automatically and only asks confirmation for risky shell commands.
- **Universal GGUF Model Support**
  - Scans your models folder (including split `-00001-of-...` GGUFs), reads GGUF v2/v3 metadata, and auto-tunes backend (Vulkan GPU or CPU), GPU layers, threads, and context window.
  - Supports native OpenAI-style tool calling with automatic fallback parsing (`<tool_call>`, `[TOOL_CALLS]`, ` ```tool `, ` ```json `) and `<think>`/`<reasoning>` extraction.
  - Fast vs. Think toggle for reasoning models, plus live token/sec, RAM/VRAM, and context usage telemetry.
- **Single Portable Executable**
  - Packages into a single standalone `LocalAI.exe` with embedded CPU + Vulkan `llama-server` binaries.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Zustand
- **Backend**: Rust, Tauri v2, `sysinfo`, `nvml-wrapper`
- **Inference**: `llama.cpp` (`llama-server.exe`) with CPU and Vulkan backends

## Getting Started (Development)

### Prerequisites

- **Windows 10/11 (x64)** with Microsoft Edge WebView2
- **Node.js** 18+
- **Rust & Cargo** (stable MSVC toolchain)
- **`llama.cpp` Windows x64 binaries** placed under:
  - `runtime/cpu/` (`llama-server.exe` + CPU/shared DLLs)
  - `runtime/vulkan/` (`llama-server.exe` + `ggml-vulkan.dll` + shared DLLs)

### Run in Dev Mode

```bash
npm install
npm run tauri dev
```

Or double-click `run-localai.bat` on Windows.

### Build Standalone `LocalAI.exe`

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package.ps1
```

This packs the CPU + Vulkan runtimes into a compressed payload, builds the release binary with `--features embed-runtime`, and outputs `LocalAI.exe` in the project root.

## Project Structure

```text
├── icons/                # App UI assets (loading animation)
├── runtime/              # Local llama.cpp CPU & Vulkan binaries (not tracked in git)
├── scripts/
│   ├── pack_runtime.mjs  # Deduplicates & compresses runtime binaries for embedding
│   └── package.ps1       # Builds standalone LocalAI.exe
├── src/                  # React + TypeScript frontend
│   ├── components/       # Composer, Conversation, Header, Overlays, Sidebar, UI
│   ├── lib/              # Agent loop, LLM SSE client, prompts, tools, Tauri bridge
│   └── store/            # Zustand stores (app, chat, stats, workspace)
├── src-tauri/            # Rust Tauri v2 backend
│   ├── capabilities/     # Tauri permission capabilities
│   ├── icons/            # App icons (.ico / .png)
│   └── src/              # Hardware detection, GGUF scanner, server manager, FS/shell tools
├── package.json
└── run-localai.bat
```

## License

MIT — see [LICENSE](LICENSE).
