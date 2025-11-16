// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod database;
mod download;
mod utils;
mod theme;
mod browser_server;
mod logger;
mod updater;
mod update_manager;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::inspect_torrent,
            commands::get_http_info,
            commands::start_download,
            commands::stop_download,
            commands::remove_download,
            commands::pause_download,
            commands::resume_download,
            commands::get_active_downloads,
            commands::get_download_history,
            commands::clear_download_history,
            commands::get_junk_data_size,
            commands::clear_junk_data,
            commands::save_speed_test_result,
            commands::get_speed_test_results,
            commands::clear_speed_test_results,
            commands::start_speed_test,
            commands::stop_speed_test,
            commands::get_settings,
            commands::save_settings,
            commands::select_torrent_file,
            commands::select_download_folder,
            commands::open_folder,
            commands::get_system_theme,
            commands::show_window,
            commands::quit_app,
            commands::get_log_path,
            commands::get_recent_logs,
            commands::open_debug_log_window,
            commands::check_for_updates,
            commands::download_update,
        ])
        .setup(|app| {
            // Initialize logger
            logger::init_logger();
            logger::log_info("app", "ACCELARA starting up");
            
            // Initialize database
            database::init().expect("Failed to initialize database");
            
            // Set up event listeners for downloads
            download::setup_download_handlers(app);
            
            // Set up system theme monitoring
            theme::setup_theme_monitoring(app.handle().clone());
            
            // Start browser integration server for browser extensions
            browser_server::start_browser_server(app.handle().clone());
            
            // Handle window close event - hide window instead of closing (daemon mode)
            // On macOS, this keeps the app running in the dock
            // Get the main window and set up close event handler
            // In Tauri 2.0, we need to wait for the window to be created
            // The window is created from the config, so we'll handle it in the event
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Wait a bit for window to be created
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                if let Some(window) = app_handle.get_webview_window("main") {
                    let app_handle_clone = app_handle.clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            // Prevent closing - hide the window instead
                            api.prevent_close();
                            if let Some(w) = app_handle_clone.get_webview_window("main") {
                                let _ = w.hide();
                            }
                        }
                    });
                }
            });
            
            // Handle app activation (dock icon click) - show window if hidden
            // On macOS, clicking the dock icon when window is hidden should restore it
            // We'll handle this by listening for window focus events and also checking periodically
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Wait for window to be created
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                if let Some(window) = app_handle.get_webview_window("main") {
                    let app_handle_clone = app_handle.clone();
                    // Listen for window focus events - if window gets focus, ensure it's visible
                    window.on_window_event(move |event| {
                        match event {
                            tauri::WindowEvent::Focused(true) => {
                                // Window is being focused - ensure it's visible
                                if let Some(w) = app_handle_clone.get_webview_window("main") {
                                    if !w.is_visible().unwrap_or(false) {
                                        let _ = w.show();
                                        let _ = w.set_focus();
                                    }
                                }
                            }
                            _ => {}
                        }
                    });
                }
            });
            
            
            // Auto-resume downloads that were in "downloading" state on app exit
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Wait a bit for the app to fully initialize
                tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
                commands::auto_resume_downloads(app_handle).await;
            });
            
            // Set up automatic update checking
            update_manager::setup_update_checking(app.handle().clone());
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
