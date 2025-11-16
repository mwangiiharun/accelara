use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::fs;
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
                    if let Ok(mut file) = fs::File::open(&log_path) {
                        use std::io::{Seek, SeekFrom, BufRead, BufReader};
                        if let Ok(metadata) = file.metadata() {
                            let total_size = metadata.len();
                            if total_size > KEEP_SIZE {
                                // Seek to position where we want to keep from
                                let skip_bytes = total_size - KEEP_SIZE;
                                if file.seek(SeekFrom::Start(skip_bytes)).is_ok() {
                                    let reader = BufReader::new(&file);
                                    // Find the first complete line (skip partial line)
                                    let mut lines = reader.lines();
                                    if lines.next().is_some() {
                                        // We found a line, now read the rest
                                        let mut keep_content = String::new();
                                        for line in lines {
                                            if let Ok(l) = line {
                                                keep_content.push_str(&l);
                                                keep_content.push('\n');
                                            }
                                        }
                                        
                                        // Write the kept content back to the file
                                        if let Ok(mut file) = fs::File::create(&log_path) {
                                            let _ = writeln!(file, "\n=== ACCELARA Log Session (Rotated) ===");
                                            let _ = writeln!(file, "Previous log file exceeded 10MB, kept last 5MB");
                                            let _ = writeln!(file, "Rotation time: {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
                                            let _ = writeln!(file, "{}", keep_content);
                                            let _ = file.flush();
                                        }
                                    }
                                }
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
        // We'll check every 100 writes or so - use a simple counter
        static mut WRITE_COUNT: u32 = 0;
        unsafe {
            WRITE_COUNT += 1;
            if WRITE_COUNT % 100 == 0 {
                check_and_clean_logs();
            }
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

