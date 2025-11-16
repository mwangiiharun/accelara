use tauri::{AppHandle, Emitter};
use std::time::Duration;

/// Set up system theme monitoring
pub fn setup_theme_monitoring(app: AppHandle) {
    // Initial theme detection - use Tauri's async runtime
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(theme) = crate::commands::get_system_theme().await {
            let _ = app_clone.emit("system-theme-changed", theme);
        }
    });
    
    // Monitor theme changes
    #[cfg(target_os = "macos")]
    {
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            use std::process::Command;
            
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                
                let output = Command::new("defaults")
                    .args(&["read", "-g", "AppleInterfaceStyle"])
                    .output();
                
                let current_theme = match output {
                    Ok(result) if result.status.success() => {
                        let theme = String::from_utf8_lossy(&result.stdout).trim().to_lowercase();
                        if theme == "dark" {
                            "dark"
                        } else {
                            "light"
                        }
                    }
                    _ => "light",
                };
                
                // Emit if theme changed
                // Note: This is a simple polling approach
                // For better performance, we could use FSEvents on macOS
                let _ = app_clone.emit("system-theme-changed", current_theme);
            }
        });
    }
    
    #[cfg(target_os = "windows")]
    {
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            use winreg::enums::*;
            use winreg::RegKey;
            
            let mut last_theme = "light".to_string();
            
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                
                let hkcu = RegKey::predef(HKEY_CURRENT_USER);
                let subkey = hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");
                
                let current_theme = match subkey {
                    Ok(key) => {
                        let apps_use_light_theme: Result<u32, _> = key.get_value("AppsUseLightTheme");
                        match apps_use_light_theme {
                            Ok(0) => "dark",
                            Ok(1) => "light",
                            _ => "light",
                        }
                    }
                    Err(_) => "light",
                };
                
                if current_theme != last_theme {
                    last_theme = current_theme.to_string();
                    let _ = app_clone.emit("system-theme-changed", current_theme);
                }
            }
        });
    }
    
    #[cfg(target_os = "linux")]
    {
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            use std::process::Command;
            
            let mut last_theme = "light".to_string();
            
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                
                let current_theme = if let Ok(output) = Command::new("gsettings")
                    .args(&["get", "org.gnome.desktop.interface", "gtk-theme"])
                    .output()
                {
                    if output.status.success() {
                        let theme = String::from_utf8_lossy(&output.stdout).to_lowercase();
                        if theme.contains("dark") {
                            "dark"
                        } else {
                            "light"
                        }
                    } else {
                        "light"
                    }
                } else {
                    "light"
                };
                
                if current_theme != last_theme {
                    last_theme = current_theme.to_string();
                    let _ = app_clone.emit("system-theme-changed", current_theme);
                }
            }
        });
    }
}

