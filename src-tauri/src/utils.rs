use std::path::{Path, PathBuf};
use std::fs;
use dirs::home_dir;
use which::which;

pub fn find_go_binary() -> Option<PathBuf> {
    use crate::logger;
    // Try to find api-wrapper binary
    // Priority: bundled location > project bin (current dir) > project bin (parent dir) > PATH
    
    // 1. Check bundled location using env::current_exe()
    // On macOS: exe is in App.app/Contents/MacOS/App
    // Resources are in App.app/Contents/Resources
    // Tauri 2.0 may put resources in Resources/_up_/bin/ instead of Resources/bin/
    if let Ok(exe_path) = std::env::current_exe() {
        logger::log_info("find_go_binary", &format!("Current exe: {}", exe_path.display()));
        if let Some(exe_dir) = exe_path.parent() {
            // Go up to Contents
            if let Some(contents_dir) = exe_dir.parent() {
                let resources_dir = contents_dir.join("Resources");
                logger::log_info("find_go_binary", &format!("Checking Resources dir: {}", resources_dir.display()));
                
                // Try Resources/bin/api-wrapper first (standard location)
                let bundled_path = resources_dir.join("bin").join("api-wrapper");
                logger::log_info("find_go_binary", &format!("Checking bundled path: {}", bundled_path.display()));
                if bundled_path.exists() {
                    logger::log_info("find_go_binary", &format!("✓ Found bundled binary at: {}", bundled_path.display()));
                    return Some(bundled_path);
                }
                
                // Try Resources/_up_/bin/api-wrapper (Tauri 2.0 internal location)
                let bundled_path_up = resources_dir.join("_up_").join("bin").join("api-wrapper");
                logger::log_info("find_go_binary", &format!("Checking Tauri _up_ path: {}", bundled_path_up.display()));
                if bundled_path_up.exists() {
                    logger::log_info("find_go_binary", &format!("✓ Found bundled binary at: {}", bundled_path_up.display()));
                    return Some(bundled_path_up);
                }
                
                logger::log_warning("find_go_binary", "Bundled binary not found in Resources/bin or Resources/_up_/bin");
                // List Resources directory contents for debugging
                if resources_dir.exists() {
                    logger::log_info("find_go_binary", "Resources directory exists, listing contents:");
                    if let Ok(entries) = std::fs::read_dir(&resources_dir) {
                        let mut contents = Vec::new();
                        for entry in entries.flatten() {
                            contents.push(entry.path().display().to_string());
                        }
                        logger::log_info("find_go_binary", &format!("Contents: {}", contents.join(", ")));
                    }
                } else {
                    logger::log_warning("find_go_binary", &format!("Resources directory does not exist: {}", resources_dir.display()));
                }
            }
        }
    }
    
    // 2. Check project bin directory (dev mode)
    // Try current directory first
    if let Ok(current_dir) = std::env::current_dir() {
        logger::log_info("find_go_binary", &format!("Current dir: {}", current_dir.display()));
        let project_bin = current_dir.join("bin").join("api-wrapper");
        logger::log_info("find_go_binary", &format!("Checking: {}", project_bin.display()));
        if project_bin.exists() {
            logger::log_info("find_go_binary", &format!("✓ Found in current dir: {}", project_bin.display()));
            return Some(project_bin);
        }
        
        // If current dir is src-tauri, go up one level
        if current_dir.ends_with("src-tauri") {
            if let Some(parent) = current_dir.parent() {
                let project_bin = parent.join("bin").join("api-wrapper");
                logger::log_info("find_go_binary", &format!("Checking parent dir: {}", project_bin.display()));
                if project_bin.exists() {
                    logger::log_info("find_go_binary", &format!("✓ Found in parent dir: {}", project_bin.display()));
                    return Some(project_bin);
                }
            }
        }
        
        // Also try using CARGO_MANIFEST_DIR if available
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let manifest_path = PathBuf::from(manifest_dir);
            if let Some(parent) = manifest_path.parent() {
                let project_bin = parent.join("bin").join("api-wrapper");
                logger::log_info("find_go_binary", &format!("Checking CARGO_MANIFEST_DIR parent: {}", project_bin.display()));
                if project_bin.exists() {
                    logger::log_info("find_go_binary", &format!("✓ Found via CARGO_MANIFEST_DIR: {}", project_bin.display()));
                    return Some(project_bin);
                }
            }
        }
    }
    
    // 3. Check PATH
    logger::log_info("find_go_binary", "Checking PATH for 'api-wrapper'");
    if let Ok(path) = which("api-wrapper") {
        logger::log_info("find_go_binary", &format!("✓ Found in PATH: {}", path.display()));
        return Some(path);
    }
    
    logger::log_error("find_go_binary", "Go binary not found in any location");
    None
}

pub fn find_iris_binary() -> Option<PathBuf> {
    use crate::logger;
    // Try to find iris binary
    // Priority: bundled location > project bin (current dir) > project bin (parent dir) > PATH
    
    // 1. Check bundled location using env::current_exe()
    // Tauri 2.0 may put resources in Resources/_up_/bin/ instead of Resources/bin/
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            if let Some(contents_dir) = exe_dir.parent() {
                let resources_dir = contents_dir.join("Resources");
                
                // Try Resources/bin/iris first (standard location)
                let bundled_path = resources_dir.join("bin").join("iris");
                logger::log_info("find_iris_binary", &format!("Checking bundled path: {}", bundled_path.display()));
                if bundled_path.exists() {
                    logger::log_info("find_iris_binary", &format!("✓ Found bundled binary at: {}", bundled_path.display()));
                    return Some(bundled_path);
                }
                
                // Try Resources/_up_/bin/iris (Tauri 2.0 internal location)
                let bundled_path_up = resources_dir.join("_up_").join("bin").join("iris");
                logger::log_info("find_iris_binary", &format!("Checking Tauri _up_ path: {}", bundled_path_up.display()));
                if bundled_path_up.exists() {
                    logger::log_info("find_iris_binary", &format!("✓ Found bundled binary at: {}", bundled_path_up.display()));
                    return Some(bundled_path_up);
                }
            }
        }
    }
    
    // 2. Check project bin directory (dev mode)
    // Try current directory first
    if let Ok(current_dir) = std::env::current_dir() {
        let project_bin = current_dir.join("bin").join("iris");
        logger::log_info("find_iris_binary", &format!("Checking: {}", project_bin.display()));
        if project_bin.exists() {
            logger::log_info("find_iris_binary", &format!("✓ Found in current dir: {}", project_bin.display()));
            return Some(project_bin);
        }
        
        // If current dir is src-tauri, go up one level
        if current_dir.ends_with("src-tauri") {
            if let Some(parent) = current_dir.parent() {
                let project_bin = parent.join("bin").join("iris");
                if project_bin.exists() {
                    logger::log_info("find_iris_binary", &format!("✓ Found in parent dir: {}", project_bin.display()));
                    return Some(project_bin);
                }
            }
        }
        
        // Also try using CARGO_MANIFEST_DIR if available
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let manifest_path = PathBuf::from(manifest_dir);
            if let Some(parent) = manifest_path.parent() {
                let project_bin = parent.join("bin").join("iris");
                if project_bin.exists() {
                    logger::log_info("find_iris_binary", &format!("✓ Found via CARGO_MANIFEST_DIR: {}", project_bin.display()));
                    return Some(project_bin);
                }
            }
        }
    }
    
    // 3. Check PATH
    logger::log_info("find_iris_binary", "Checking PATH for 'iris'");
    if let Ok(path) = which("iris") {
        logger::log_info("find_iris_binary", &format!("✓ Found in PATH: {}", path.display()));
        return Some(path);
    }
    
    logger::log_error("find_iris_binary", "Iris binary not found in any location");
    None
}

pub fn verify_binary_path(binary_path: &Path) -> Result<PathBuf, String> {
    if !binary_path.exists() {
        return Err(format!("Binary not found: {}", binary_path.display()));
    }
    
    let metadata = fs::metadata(binary_path)
        .map_err(|e| format!("Failed to read binary metadata: {}", e))?;
    
    if !metadata.is_file() {
        return Err(format!("Path is not a file: {}", binary_path.display()));
    }
    
    // On Unix, check if executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = metadata.permissions();
        if perms.mode() & 0o111 == 0 {
            return Err(format!("Binary is not executable: {}", binary_path.display()));
        }
    }
    
    Ok(binary_path.to_path_buf())
}

pub fn get_working_directory() -> PathBuf {
    // In production, use home directory
    // In dev, use project root
    if std::env::var("TAURI_DEV").is_ok() {
        std::env::current_dir().unwrap_or_else(|_| home_dir().unwrap())
    } else {
        home_dir().unwrap()
    }
}

/// Expand `~` in a path to the home directory and make it absolute
pub fn expand_path(path: &str) -> String {
    let expanded = if path.starts_with("~/") {
        if let Some(home) = home_dir() {
            path.replacen("~", &home.to_string_lossy(), 1)
        } else {
            path.to_string()
        }
    } else if path == "~" {
        if let Some(home) = home_dir() {
            home.to_string_lossy().to_string()
        } else {
            path.to_string()
        }
    } else {
        path.to_string()
    };
    
    // Convert to absolute path if it's relative
    if let Ok(absolute) = std::fs::canonicalize(&expanded) {
        absolute.to_string_lossy().to_string()
    } else {
        // If canonicalize fails (path doesn't exist), try to make it absolute relative to current dir
        if Path::new(&expanded).is_absolute() {
            expanded
        } else {
            // Relative path - make it absolute relative to home directory
            if let Some(home) = home_dir() {
                home.join(&expanded).to_string_lossy().to_string()
            } else {
                expanded
            }
        }
    }
}

