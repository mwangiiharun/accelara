use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::fs;
use std::sync::atomic::{AtomicU32, Ordering};
use dirs::home_dir;

/// Initialize logging to a file in production
pub fn init_logger() {
    if let Some(log_path) = get_log_path() {
        // Create log file if it doesn't exist
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            let _ = writeln!(file, "\n=== ACCELARA Log Session Started ===");
            let _ = writeln!(file, "Log file: {}", log_path.display());
            let _ = file.flush();
        }
    }
}

/// Get the log file path
fn get_log_path() -> Option<PathBuf> {
    if let Some(home) = home_dir() {
        let log_dir = home.join(".accelara");
        // Create directory if it doesn't exist
        let _ = std::fs::create_dir_all(&log_dir);
        Some(log_dir.join("accelara.log"))
    } else {
        None
    }
}

/// Check and clean log file if it exceeds 10MB
fn check_and_clean_logs() {
    if let Some(log_path) = get_log_path() {
        if log_path.exists() {
            if let Ok(metadata) = fs::metadata(&log_path) {
                const MAX_LOG_SIZE: u64 = 10 * 1024 * 1024; // 10MB
                if metadata.len() > MAX_LOG_SIZE {
                    // Rotate: keep last 5MB of logs
                    const KEEP_SIZE: u64 = 5 * 1024 * 1024; // 5MB
                    
                    // Read the file
                    if let Ok(content) = fs::read_to_string(&log_path) {
                        let total_size = content.len() as u64;
                        if total_size > KEEP_SIZE {
                            // Keep only the last portion
                            let skip_bytes = (total_size - KEEP_SIZE) as usize;
                            // Find the next newline to avoid cutting in the middle of a line
                            let start_pos = if skip_bytes < content.len() {
                                content[skip_bytes..]
                                    .find('\n')
                                    .map(|pos| skip_bytes + pos + 1)
                                    .unwrap_or(skip_bytes)
                            } else {
                                skip_bytes
                            };
                            
                            let kept_content = &content[start_pos..];
                            
                            // Write the kept content back to the file with a rotation header
                            if let Ok(mut file) = fs::File::create(&log_path) {
                                let _ = writeln!(file, "\n=== ACCELARA Log Session (Rotated) ===");
                                let _ = writeln!(file, "Previous log file exceeded 10MB, kept last 5MB");
                                let _ = writeln!(file, "Rotation time: {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
                                let _ = writeln!(file, "{}", kept_content);
                                let _ = file.flush();
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Write a log message to file
pub fn log_to_file(message: &str) {
    if let Some(log_path) = get_log_path() {
        // Check and clean logs before writing (only check periodically to avoid overhead)
        // We'll check every 100 writes or so - use an atomic counter
        static WRITE_COUNT: AtomicU32 = AtomicU32::new(0);
        let count = WRITE_COUNT.fetch_add(1, Ordering::Relaxed);
        if count % 100 == 0 {
            check_and_clean_logs();
        }
        
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
            let _ = writeln!(file, "[{}] {}", timestamp, message);
            let _ = file.flush();
        }
    }
    // Also print to stderr (visible in console if available)
    eprintln!("{}", message);
}

/// Log an error with context
pub fn log_error(context: &str, error: &str) {
    let message = format!("[ERROR] {}: {}", context, error);
    log_to_file(&message);
}

/// Log a warning with context
#[allow(dead_code)]
pub fn log_warning(context: &str, warning: &str) {
    let message = format!("[WARN] {}: {}", context, warning);
    log_to_file(&message);
}

/// Log info with context
pub fn log_info(context: &str, info: &str) {
    let message = format!("[INFO] {}: {}", context, info);
    log_to_file(&message);
}

