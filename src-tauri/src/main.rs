#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod command;
mod config;
mod embedded_runtime;
mod errors;
mod gpu;
mod hardware;
mod models;
mod monitor;
mod paths;
mod search;
mod server;
mod updater;
mod workspace_fs;
mod workspaces;

use command::{is_dangerous_command, run_command};
use config::{get_config, get_paths, save_config, AppConfig, ConfigState};
use hardware::{detect_hardware, warm_hardware_cache};
use models::scan_models;
use monitor::start_monitor;
use paths::AppPaths;
use search::search_files;
use server::{start_server, stop_server, ServerManager};
use updater::check_for_update;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use workspace_fs::{
    apply_write, list_dir, list_workspace_files, preview_replace, preview_write, read_file,
};
use workspaces::{
    add_workspace, delete_conversation, list_conversations, list_workspaces, load_conversation,
    open_external_url, open_in_explorer, remove_workspace, rename_conversation, save_conversation,
    search_conversations, update_workspace,
};

fn main() {
    let app_paths = AppPaths::resolve();
    app_paths.append_app_log("INFO", "Starting LocalAI");

    let initial_config = AppConfig::load_or_init(&app_paths).unwrap_or_else(|err| {
        app_paths.append_app_log("WARN", &format!("Failed to load config: {err}"));
        AppConfig::default()
    });
    let monitor_interval = initial_config.monitor_interval_ms;

    let pid_tracker = Arc::new(Mutex::new(None));
    let server_manager = Arc::new(ServerManager::new(Arc::clone(&pid_tracker)));

    let webview_dir = app_paths.data_dir.join("webview");
    let runtime_dir_for_setup = app_paths.runtime_dir.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_paths)
        .manage(ConfigState(Mutex::new(initial_config)))
        .manage(Arc::clone(&server_manager))
        .invoke_handler(tauri::generate_handler![
            get_paths,
            get_config,
            save_config,
            detect_hardware,
            scan_models,
            start_server,
            stop_server,
            list_workspaces,
            add_workspace,
            update_workspace,
            remove_workspace,
            list_conversations,
            load_conversation,
            save_conversation,
            delete_conversation,
            rename_conversation,
            search_conversations,
            open_in_explorer,
            open_external_url,
            list_dir,
            list_workspace_files,
            read_file,
            search_files,
            preview_write,
            preview_replace,
            apply_write,
            run_command,
            is_dangerous_command,
            check_for_update
        ])
        .setup(move |app| {
            let mut created = false;
            for attempt in 0..5 {
                let dir = if attempt < 4 {
                    webview_dir.clone()
                } else {
                    webview_dir.with_file_name(format!("webview-{}", std::process::id()))
                };
                let res = tauri::WebviewWindowBuilder::new(
                    app,
                    "main",
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .title("LocalAI")
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 600.0)
                .decorations(true)
                .resizable(true)
                .icon(tauri::include_image!("icons/icon.png"))?
                .data_directory(dir)
                .build();

                match res {
                    Ok(_) => {
                        created = true;
                        break;
                    }
                    Err(_) if attempt < 4 => {
                        std::thread::sleep(std::time::Duration::from_millis(450));
                    }
                    Err(e) => return Err(Box::new(e)),
                }
            }
            if !created {
                return Err("Could not create main WebView2 window".into());
            }

            warm_hardware_cache();
            if embedded_runtime::is_embedded_build() {
                let rt_dir = runtime_dir_for_setup.clone();
                std::thread::spawn(move || {
                    let _ = embedded_runtime::ensure_extracted(&rt_dir);
                });
            }
            start_monitor(
                app.handle().clone(),
                Arc::clone(&pid_tracker),
                monitor_interval,
            );
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building LocalAI");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            app_handle.state::<Arc<ServerManager>>().stop_sync();
        }
    });
}
