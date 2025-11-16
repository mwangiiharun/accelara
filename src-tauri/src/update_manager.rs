use crate::updater;
use crate::database;
use crate::logger;
use tauri::{AppHandle, Emitter};
use std::time::Duration;

/// Set up automatic update checking
pub fn setup_update_checking(app: AppHandle) {
    let app_clone = app.clone();
    
    // Check on startup if enabled
    tauri::async_runtime::spawn(async move {
        // Wait a bit for app to fully initialize
        tokio::time::sleep(Duration::from_secs(5)).await;
        
        if should_auto_check() {
            logger::log_info("update_manager", "Auto-checking for updates on startup...");
            check_and_notify(&app_clone).await;
        }
    });
    
    // Periodic background checks
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let interval_hours = get_check_interval();
            let interval_secs = interval_hours * 3600;
            
            logger::log_info("update_manager", &format!("Waiting {} hours before next update check...", interval_hours));
            tokio::time::sleep(Duration::from_secs(interval_secs)).await;
            
            if should_auto_check() {
                logger::log_info("update_manager", "Periodic update check...");
                check_and_notify(&app_clone).await;
            }
        }
    });
}

/// Check if auto-check is enabled
fn should_auto_check() -> bool {
    if let Ok(conn) = database::get_connection() {
        if let Ok(value) = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            ["autoCheckForUpdates"],
            |row| row.get::<_, String>(0),
        ) {
            if let Ok(enabled) = serde_json::from_str::<bool>(&value) {
                return enabled;
            }
        }
    }
    // Default to true if not set
    true
}

/// Get check interval in hours
fn get_check_interval() -> u64 {
    if let Ok(conn) = database::get_connection() {
        if let Ok(value) = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            ["updateCheckInterval"],
            |row| row.get::<_, String>(0),
        ) {
            if let Ok(interval) = serde_json::from_str::<u64>(&value) {
                return interval;
            }
        }
    }
    // Default to 24 hours
    24
}

/// Check for updates and emit notification if available
async fn check_and_notify(app: &AppHandle) {
    let result = updater::check_for_updates().await;
    
    if let Some(error) = &result.error {
        logger::log_error("update_manager", &format!("Update check failed: {}", error));
        return;
    }
    
    if result.has_update {
        logger::log_info("update_manager", &format!("Update available: {} -> {}", 
            result.current_version, result.latest_version));
        
        // Emit update available event
        let _ = app.emit("update-available", serde_json::json!({
            "current_version": result.current_version,
            "latest_version": result.latest_version,
            "release_info": result.release_info,
        }));
        
        // Show system notification
        #[cfg(target_os = "macos")]
        {
            use std::process::Command;
            let title = format!("ACCELARA Update Available");
            let body = format!("Version {} is now available (you have {})", 
                result.latest_version, result.current_version);
            
            let _ = Command::new("osascript")
                .arg("-e")
                .arg(format!(r#"display notification "{}" with title "{}""#, body, title))
                .output();
        }
        
        #[cfg(target_os = "windows")]
        {
            // Windows notifications require additional setup
            // For now, we'll just emit the event
        }
        
        #[cfg(target_os = "linux")]
        {
            use std::process::Command;
            let title = "ACCELARA Update Available";
            let body = format!("Version {} is now available (you have {})", 
                result.latest_version, result.current_version);
            
            let _ = Command::new("notify-send")
                .arg(title)
                .arg(&body)
                .output();
        }
    } else {
        logger::log_info("update_manager", "No updates available");
    }
}

