# LocalAI

**A free, private AI app for Windows that runs 100% offline on your own computer.**

Download one file (`LocalAI.exe`), pick any `.gguf` AI model on your PC, and start chatting or coding—with no internet connection, no subscriptions, no API keys, and no extra software to install.

👉 **[Download LocalAI.exe](https://github.com/Real-Dark-Horse/LocalAi/releases/latest/download/LocalAI.exe)**
---


<img width="1282" height="852" alt="image" src="https://github.com/user-attachments/assets/d4da2c54-c428-4a8c-b436-3fa968a8d6ab" />

## How LocalAI Can Help You

- **100% Private & Offline:** Your chats, documents, and code never leave your computer.
- **Zero Monthly Fees:** Run open-weight `.gguf` models on your own PC with no token limits or subscriptions.
- **Single Portable File:** Everything needed to run AI models (CPU and Vulkan GPU engines) is built right into `LocalAI.exe`—no Python, Docker, or external installs needed.
- **Great for Both Everyday Chat & Coding:** Ask general questions in **Chat** mode, or open a project folder so the AI can read your files, suggest edits, and run tests.
- **Automatic Hardware Tuning:** Detects your CPU, RAM, and GPU automatically to pick good settings, while letting you customize context size, GPU layers, threads, and temperature anytime.

---

<img width="1282" height="852" alt="image" src="https://github.com/user-attachments/assets/bc2d9ea8-12c1-4f6d-bc0b-4390434890be" />


## Features

### Three Modes for Any Task
Switch modes anytime from the bottom-left menu:
- **Chat Mode:** General-purpose AI chat with no project folder required. Ideal for questions, writing, summarizing, and quick code snippets.
- **Ask Mode (Coding):** Open a project folder and let LocalAI inspect files, edit code, and run commands—showing a diff preview and asking your approval before every change or command.
- **Auto Mode (Coding):** Autonomous coding mode that reads and edits files automatically, only pausing to ask confirmation before risky commands.

<img width="1282" height="852" alt="image" src="https://github.com/user-attachments/assets/123d6cb4-5a74-4829-982f-eeeaeca96f04" />


### Built-in Coding Tools
In **Ask** and **Auto** modes, LocalAI can:
- Browse folders, search across your codebase, and read files.
- Create new files and make targeted edits with clear diff previews.
- Run commands in PowerShell or CMD (with safety blocks against destructive system commands).
- Let you attach or mention files quickly by typing `@filename` or clicking the attach button.

### Broad Model Support & Controls
- **GGUF Models:** Supports `.gguf` text-generation models (including split multi-part files like `-00001-of-...`) across Qwen, Llama, Gemma, Mistral, DeepSeek, Phi, and more.
- **Fast vs. Think Toggle:** Switch between **Fast** mode for quick direct answers and **Think** mode for step-by-step reasoning on thinking models.
- **Live Telemetry:** View tokens/sec speed, context window usage, CPU/RAM, and GPU/VRAM usage directly in the app.
- **Search & Export:** Search conversations with `Ctrl+K`, toggle the sidebar with `Ctrl+B`, rename chats, and export any conversation to Markdown.
- **Update Notifications:** Automatically checks GitHub Releases on startup (when online) and notifies you when a newer version of `LocalAI.exe` is available to download.

---

## How to Use It

1. **Download LocalAI**
   - Click **[Download LocalAI.exe](https://github.com/Real-Dark-Horse/LocalAi/releases/latest/download/LocalAI.exe)** and save it anywhere on your Windows PC.
2. **Download a `.gguf` Model**
   - Download any **Text Generation** `.gguf` model from Hugging Face (for example, `Qwen3-4B-Q4_K_M.gguf` or `Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf`) into a folder on your PC.
   - *Tip:* On a 16 GB RAM PC, 4B–8B `Q4_K_M` models offer the best balance of speed and quality.
3. **Open `LocalAI.exe` and Start**
   - Double-click `LocalAI.exe`, choose the folder containing your `.gguf` files, select a model, and click **Load Model**.
   - **To chat:** Pick **Chat** mode (or click **CHATS → +**) and start typing—no project folder needed.
   - **To code:** Click **WORKSPACES → +** to open your project folder, choose **Ask** or **Auto** mode, and tell LocalAI what to build, explain, or fix.
