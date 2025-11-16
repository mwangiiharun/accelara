use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
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

/// Write a log message to file
pub fn log_to_file(message: &str) {
    if let Some(log_path) = get_log_path() {
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

