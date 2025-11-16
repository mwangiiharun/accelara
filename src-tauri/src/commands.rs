use crate::database;
use crate::download;
use crate::utils;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, Emitter};
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex;

// Global map to track download processes
lazy_static::lazy_static! {
    pub static ref DOWNLOAD_PROCESSES: Arc<Mutex<HashMap<String, tokio::process::Child>>> = Arc::new(Mutex::new(HashMap::new()));
    pub static ref SPEED_TEST_PROCESSES: Arc<Mutex<HashMap<String, tokio::process::Child>>> = Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadConfig {
    pub source: String,
    pub output: Option<String>,
    pub options: Option<serde_json::Value>,
}

// Handler 1: inspect-torrent
#[command]
pub async fn inspect_torrent(source: String) -> Result<serde_json::Value, String> {
    use crate::logger;
    
    logger::log_info("inspect_torrent", &format!("Inspecting torrent: {}", source));
    
    let go_binary = utils::find_go_binary()
        .ok_or_else(|| {
            let error = "Go binary (api-wrapper) not found";
            logger::log_error("inspect_torrent", error);
            error.to_string()
        })?;
    
    logger::log_info("inspect_torrent", &format!("Using Go binary: {}", go_binary.display()));
    
    let verified_binary = utils::verify_binary_path(&go_binary)
        .map_err(|e| {
            logger::log_error("inspect_torrent", &e);
            format!("Binary verification failed: {}", e)
        })?;
    
    logger::log_info("inspect_torrent", &format!("Verified binary path: {}", verified_binary.display()));
    
    let working_dir = utils::get_working_directory();
    
    let output = TokioCommand::new(&verified_binary)
        .args(&["--inspect", "--source", &source])
        .current_dir(&working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to spawn process: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Process failed: {}", stderr));
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    
    // Parse JSON output
    serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse JSON: {}", e))
}

// Handler 2: get-http-info
#[command]
pub async fn get_http_info(source: String) -> Result<serde_json::Value, String> {
    let go_binary = utils::find_go_binary()
        .ok_or_else(|| "Go binary (api-wrapper) not found".to_string())?;
    
    let verified_binary = utils::verify_binary_path(&go_binary)
        .map_err(|e| format!("Binary verification failed: {}", e))?;
    
    let working_dir = utils::get_working_directory();
    
    let output = TokioCommand::new(&verified_binary)
        .args(&["--http-info", "--source", &source])
        .current_dir(&working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to spawn process: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Process failed: {}", stderr));
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    
    // Parse JSON output
    serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse JSON: {}", e))
}

// Helper function to build command args for downloads
fn build_command_args(
    source: &str,
    output_path: &str,
    download_id: &str,
    options: &Option<serde_json::Value>,
) -> Vec<String> {
    // Expand ~ in output path to absolute path
    let expanded_output = utils::expand_path(output_path);
    
    let mut args = vec![
        "--source".to_string(),
        source.to_string(),
        "--output".to_string(),
        expanded_output,
        "--download-id".to_string(),
        download_id.to_string(),
    ];
    
    if let Some(opts) = options {
        // Helper to get value with fallback to snake_case or camelCase
        let get_str = |key: &str, snake_key: &str| -> Option<String> {
            opts.get(key)
                .or_else(|| opts.get(snake_key))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        };
        
        let get_u64 = |key: &str, snake_key: &str| -> Option<u64> {
            opts.get(key)
                .or_else(|| opts.get(snake_key))
                .and_then(|v| v.as_u64())
        };
        
        let get_bool = |key: &str, snake_key: &str| -> Option<bool> {
            opts.get(key)
                .or_else(|| opts.get(snake_key))
                .and_then(|v| v.as_bool())
        };
        
        // Concurrency (number of concurrent connections)
        if let Some(concurrency) = get_u64("concurrency", "concurrency") {
            args.push("--concurrency".to_string());
            args.push(concurrency.to_string());
        }
        
        // Chunk size (supports both chunkSize and chunk_size)
        if let Some(chunk_size) = get_str("chunkSize", "chunk_size") {
            if !chunk_size.is_empty() {
                args.push("--chunk-size".to_string());
                args.push(chunk_size);
            }
        }
        
        // Rate limit (download speed limit) - Go uses --limit, not --rate-limit
        // Supports both rateLimit/rate_limit and limit
        if let Some(rate_limit) = get_str("rateLimit", "rate_limit")
            .or_else(|| get_str("limit", "limit")) {
            if !rate_limit.is_empty() {
                args.push("--limit".to_string());
                args.push(rate_limit);
            }
        }
        
        // BitTorrent upload limit (supports both btUploadLimit and bt_upload_limit)
        if let Some(bt_upload_limit) = get_str("btUploadLimit", "bt_upload_limit") {
            if !bt_upload_limit.is_empty() {
                args.push("--bt-upload-limit".to_string());
                args.push(bt_upload_limit);
            }
        }
        
        // BitTorrent sequential mode - Go uses --bt-sequential, not --sequential
        // Supports both sequentialMode and bt_sequential
        if let Some(sequential) = get_bool("sequentialMode", "bt_sequential")
            .or_else(|| get_bool("sequential", "sequential")) {
            if sequential {
                args.push("--bt-sequential".to_string());
            }
        }
        
        // BitTorrent keep seeding (supports both btKeepSeeding and bt_keep_seeding)
        if let Some(keep_seeding) = get_bool("btKeepSeeding", "bt_keep_seeding") {
            if keep_seeding {
                args.push("--bt-keep-seeding".to_string());
            }
        }
        
        // BitTorrent port (supports both btPort and bt_port)
        if let Some(bt_port) = get_u64("btPort", "bt_port") {
            args.push("--bt-port".to_string());
            args.push(bt_port.to_string());
        }
        
        // Connect timeout (supports both connectTimeout and connect_timeout)
        if let Some(connect_timeout) = get_u64("connectTimeout", "connect_timeout") {
            args.push("--connect-timeout".to_string());
            args.push(connect_timeout.to_string());
        }
        
        // Read timeout (supports both readTimeout and read_timeout)
        if let Some(read_timeout) = get_u64("readTimeout", "read_timeout") {
            args.push("--read-timeout".to_string());
            args.push(read_timeout.to_string());
        }
        
        // Retries
        if let Some(retries) = get_u64("retries", "retries") {
            args.push("--retries".to_string());
            args.push(retries.to_string());
        }
        
        // SHA256 hash verification
        if let Some(sha256) = get_str("sha256", "sha256") {
            if !sha256.is_empty() {
                args.push("--sha256".to_string());
                args.push(sha256);
            }
        }
    }
    
    args
}

// Handler 3: start-download
#[command]
pub async fn start_download(
    config: DownloadConfig,
    app: tauri::AppHandle,
) -> Result<String, String> {
    
    // Generate download ID
    let download_id = format!("{}-{}", 
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis(),
        nanoid::nanoid!(9)
    );
    
    // Determine output path
    // For torrents, output should be a directory (the Go code uses it as DataDir)
    // For HTTP, output should be a file path
    let output_path = if let Some(output) = &config.output {
        output.clone()
    } else {
        // Use default download path from settings
        let settings = get_settings().await.unwrap_or_default();
        let default_path = settings
            .get("defaultDownloadPath")
            .and_then(|v| v.as_str())
            .unwrap_or("~/Downloads");
        
        // For torrents, use the directory as-is (Go will create torrent name folder inside)
        // For HTTP, generate filename from source
        if config.source.starts_with("magnet:") || 
           config.source.ends_with(".torrent") ||
           std::path::Path::new(&config.source).extension()
               .and_then(|e| e.to_str())
               .map(|e| e.eq_ignore_ascii_case("torrent"))
               .unwrap_or(false) {
            // Torrent: output is the directory where torrent files will be saved
            default_path.to_string()
        } else {
            // HTTP: output is the file path
            let filename = std::path::Path::new(&config.source)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("download");
            format!("{}/{}", default_path, filename)
        }
    };
    
    // Determine download type
    // Check for magnet links, .torrent files, or paths containing .torrent
    let download_type = if config.source.starts_with("magnet:") {
        "magnet"
    } else if config.source.ends_with(".torrent") || 
              config.source.contains(".torrent") ||
              std::path::Path::new(&config.source).extension()
                  .and_then(|e| e.to_str())
                  .map(|e| e.eq_ignore_ascii_case("torrent"))
                  .unwrap_or(false) {
        "torrent"
    } else {
        "http"
    };
    
    // Save to database with paused status
    let conn = database::get_connection()
        .map_err(|e| format!("Database error: {}", e))?;
    
    let metadata = serde_json::json!({
        "pause_reason": "Paused - click resume to start",
        "options": config.options,
    });
    
    conn.execute(
        "INSERT INTO downloads (id, source, output, type, status, progress, downloaded, total, speed, metadata, started_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            download_id,
            config.source,
            output_path,
            download_type,
            "paused",
            0.0,
            0,
            0,
            0,
            serde_json::to_string(&metadata).unwrap(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
        ],
    )
    .map_err(|e| format!("Failed to insert download: {}", e))?;
    
    // Emit download update event
    app.emit("download-update", serde_json::json!({
        "downloadId": download_id,
        "download_id": download_id,
        "source": config.source,
        "output": output_path,
        "type": download_type,
        "status": "paused",
        "progress": 0,
        "downloaded": 0,
        "total": 0,
        "speed": 0,
        "pause_reason": "Paused - click resume to start",
    }))
    .map_err(|e| format!("Failed to emit event: {}", e))?;
    
    Ok(download_id)
}

// Handler 4: stop-download
#[command]
pub async fn stop_download(download_id: String) -> Result<(), String> {
    let mut processes = DOWNLOAD_PROCESSES.lock().await;
    
    if let Some(mut child) = processes.remove(&download_id) {
        child.kill().await
            .map_err(|e| format!("Failed to kill process: {}", e))?;
    }
    
    Ok(())
}

// Handler 5: remove-download
#[command]
pub async fn remove_download(
    download_id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Stop process if running
    stop_download(download_id.clone()).await?;
    
    // Get download info before deletion
    let conn = database::get_connection()
        .map_err(|e| format!("Database error: {}", e))?;
    
    let output: Result<String, _> = conn.query_row(
        "SELECT output FROM downloads WHERE id = ?1",
        [&download_id],
        |row| row.get(0),
    );
    
    // Delete from database
    conn.execute("DELETE FROM downloads WHERE id = ?1", [&download_id])
        .map_err(|e| format!("Failed to delete download: {}", e))?;
    
    // Try to delete partial files if they exist
    if let Ok(output_path) = output {
        if let Some(path) = std::path::Path::new(&output_path).parent() {
            if path.exists() {
                // Delete .accelara-temp-* directories
                if let Ok(entries) = std::fs::read_dir(path) {
                    for entry in entries.flatten() {
                        if let Some(name) = entry.file_name().to_str() {
                            if name.starts_with(".accelara-temp-") {
                                let _ = std::fs::remove_dir_all(entry.path());
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Emit removal event
    app.emit("download-removed", serde_json::json!({
        "downloadId": download_id,
    }))
    .map_err(|e| format!("Failed to emit event: {}", e))?;
    
    Ok(())
}

// Handler 6: pause-download
#[command]
pub async fn pause_download(
    download_id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Kill the process (SIGTERM on Unix)
    let mut processes = DOWNLOAD_PROCESSES.lock().await;
    
    if let Some(mut child) = processes.remove(&download_id) {
        #[cfg(unix)]
        {
            if let Some(pid) = child.id() {
                let _ = std::process::Command::new("kill")
                    .arg("-TERM")
                    .arg(pid.to_string())
                    .output();
            }
        }
        let _ = child.kill().await;
    }
    
    // Update database
    let conn = database::get_connection()
        .map_err(|e| format!("Database error: {}", e))?;
    
    let download: Result<Option<String>, _> = conn.query_row(
        "SELECT metadata FROM downloads WHERE id = ?1",
        [&download_id],
        |row| row.get::<_, Option<String>>(0),
    );
    
    if let Ok(Some(metadata_str)) = download {
        let mut metadata: serde_json::Value = serde_json::from_str(&metadata_str)
            .unwrap_or_else(|_| serde_json::json!({}));
        
        metadata["pause_reason"] = serde_json::json!("Paused by user");
        metadata["paused_at"] = serde_json::json!(SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs());
        
        conn.execute(
            "UPDATE downloads SET status = ?, metadata = ? WHERE id = ?",
            rusqlite::params!["paused", serde_json::to_string(&metadata).unwrap(), download_id],
        )
        .map_err(|e| format!("Failed to update download: {}", e))?;
        
        // Emit update event
        app.emit("download-update", serde_json::json!({
            "downloadId": download_id,
            "download_id": download_id,
            "status": "paused",
            "pause_reason": "Paused by user",
        }))
        .map_err(|e| format!("Failed to emit event: {}", e))?;
    }
    
    Ok(())
}

/// Auto-resume downloads that were in "downloading" state when app exited
pub async fn auto_resume_downloads(app: tauri::AppHandle) {
    // Get download IDs synchronously (before any await)
    let download_ids: Vec<String> = {
        let conn = match database::get_connection() {
            Ok(conn) => conn,
            Err(e) => {
                eprintln!("[auto-resume] Failed to get database connection: {}", e);
                return;
            }
        };
        
        // Find all downloads that were in "downloading" state
        let mut stmt = match conn.prepare(
            "SELECT id FROM downloads WHERE status = 'downloading' ORDER BY started_at ASC"
        ) {
            Ok(stmt) => stmt,
            Err(e) => {
                eprintln!("[auto-resume] Failed to prepare statement: {}", e);
                return;
            }
        };
        
        // Collect all results before dropping the connection
        let mut ids = Vec::new();
        let rows_iter = match stmt.query_map([], |row| {
            Ok(row.get::<_, String>(0)?)
        }) {
            Ok(rows) => rows,
            Err(e) => {
                eprintln!("[auto-resume] Failed to query downloads: {}", e);
                return;
            }
        };
        
        // Collect all results immediately
        for row_result in rows_iter {
            match row_result {
                Ok(id) => ids.push(id),
                Err(e) => {
                    eprintln!("[auto-resume] Failed to process row: {}", e);
                }
            }
        }
        ids
    };
    
    if download_ids.is_empty() {
        eprintln!("[auto-resume] No downloads to resume");
        return;
    }
    
    eprintln!("[auto-resume] Found {} download(s) to resume", download_ids.len());
    
    // Resume each download with a small delay between them
    for (index, download_id) in download_ids.iter().enumerate() {
        if index > 0 {
            // Small delay between resuming multiple downloads
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        }
        
        eprintln!("[auto-resume] Resuming download: {}", download_id);
        
        // Call resume_download logic directly (not as a command)
        match resume_download_internal(download_id.clone(), app.clone()).await {
            Ok(_) => {
                eprintln!("[auto-resume] Successfully resumed download: {}", download_id);
            }
            Err(e) => {
                eprintln!("[auto-resume] Failed to resume download {}: {}", download_id, e);
                // Update status to "paused" so user can manually resume
                if let Ok(conn) = database::get_connection() {
                    let _ = conn.execute(
                        "UPDATE downloads SET status = ? WHERE id = ?",
                        rusqlite::params!["paused", download_id],
                    );
                }
            }
        }
    }
}

/// Internal resume function (extracted from resume_download command)
async fn resume_download_internal(
    download_id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Check if process exists (shouldn't after app restart)
    let mut processes = DOWNLOAD_PROCESSES.lock().await;
    
    if processes.contains_key(&download_id) {
        // Process exists, just update status
        let conn = database::get_connection()
            .map_err(|e| format!("Database error: {}", e))?;
        
        conn.execute(
            "UPDATE downloads SET status = ? WHERE id = ?",
            rusqlite::params!["downloading", download_id],
        )
        .map_err(|e| format!("Failed to update download: {}", e))?;
        
        app.emit("download-update", serde_json::json!({
            "downloadId": download_id,
            "download_id": download_id,
            "status": "downloading",
        }))
        .map_err(|e| format!("Failed to emit event: {}", e))?;
        
        return Ok(());
    }
    
    // Process doesn't exist - start new one
    let conn = database::get_connection()
        .map_err(|e| format!("Database error: {}", e))?;
    
    // Get download info including progress
    let download: Result<(String, String, String, Option<String>, f64, i64, i64), _> = conn.query_row(
        "SELECT source, output, type, metadata, progress, downloaded, total FROM downloads WHERE id = ?1",
        [&download_id],
        |row| Ok((
            row.get(0)?, 
            row.get(1)?, 
            row.get(2)?, 
            row.get::<_, Option<String>>(3)?,
            row.get::<_, f64>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?,
        )),
    );
    
    let (source, output, _download_type, metadata_str_opt, existing_progress, existing_downloaded, existing_total) = download
        .map_err(|_| "Download not found".to_string())?;
    
    // The Go binary will automatically check for existing files and resume
    // We don't need to pass progress to it - it handles file checking internally
    
    let metadata: serde_json::Value = if let Some(ref s) = metadata_str_opt {
        serde_json::from_str(s).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    
    let options = metadata.get("options").cloned();
    
    // Build command args
    let args = build_command_args(&source, &output, &download_id, &options);
    
    // Get expanded output path for logging and checking
    let expanded_output = args.iter().skip(3).next().cloned().unwrap_or_else(|| "N/A".to_string());
    
    eprintln!("[resume-download] Resuming download:");
    eprintln!("  - Download ID: {}", download_id);
    eprintln!("  - Source: {}", source);
    eprintln!("  - Original output: {}", output);
    eprintln!("  - Expanded output: {}", expanded_output);
    eprintln!("  - Existing progress: {:.2}% ({} / {} bytes)", 
              existing_progress * 100.0, existing_downloaded, existing_total);
    
    // Check for existing files based on download type
    use std::path::Path;
    let output_path = Path::new(&expanded_output);
    
    if _download_type == "http" {
        // HTTP downloads: Check for chunk files in temp directory
        eprintln!("  - Checking for existing chunk files at: {}", expanded_output);
        if let Some(file_name) = output_path.file_name() {
            let temp_dir_name = format!(".accelara-temp-{}", file_name.to_string_lossy());
            eprintln!("  - Looking for temp directory: {}", temp_dir_name);
            if let Some(parent) = output_path.parent() {
                let temp_dir = parent.join(&temp_dir_name);
                eprintln!("  - Full temp dir path: {}", temp_dir.display());
                if temp_dir.exists() {
                    eprintln!("  - ✓ Found temp directory: {}", temp_dir.display());
                    // Check for chunk files
                    if let Ok(entries) = std::fs::read_dir(&temp_dir) {
                        let chunk_files: Vec<String> = entries
                            .filter_map(|e| {
                                e.ok().and_then(|entry| {
                                    let path = entry.path();
                                    if path.to_string_lossy().contains(".part.") {
                                        Some(path.to_string_lossy().to_string())
                                    } else {
                                        None
                                    }
                                })
                            })
                            .collect();
                        eprintln!("  - ✓ Found {} chunk file(s):", chunk_files.len());
                        for chunk in chunk_files.iter().take(5) {
                            eprintln!("    - {}", chunk);
                        }
                        if chunk_files.is_empty() {
                            eprintln!("  - ⚠️  WARNING: Temp directory exists but no chunk files found!");
                        }
                    } else {
                        eprintln!("  - ⚠️  ERROR: Cannot read temp directory");
                    }
                } else {
                    eprintln!("  - ⚠️  WARNING: Temp directory not found: {}", temp_dir.display());
                    eprintln!("  - Parent directory exists: {}", parent.exists());
                    if parent.exists() {
                        eprintln!("  - Parent directory contents:");
                        if let Ok(entries) = std::fs::read_dir(parent) {
                            for entry in entries.take(10) {
                                if let Ok(e) = entry {
                                    eprintln!("    - {}", e.path().display());
                                }
                            }
                        }
                    }
                }
            } else {
                eprintln!("  - ⚠️  ERROR: Cannot get parent directory from: {}", expanded_output);
            }
        } else {
            eprintln!("  - ⚠️  ERROR: Cannot get filename from: {}", expanded_output);
        }
    } else if _download_type == "torrent" || _download_type == "magnet" {
        // Torrent downloads: Check for existing files/folders in the output directory
        // The output path is the DataDir where torrent files are stored
        eprintln!("  - Checking for existing torrent files in directory: {}", expanded_output);
        if output_path.exists() {
            if output_path.is_dir() {
                eprintln!("  - ✓ Output directory exists: {}", expanded_output);
                // List contents of the directory
                if let Ok(entries) = std::fs::read_dir(output_path) {
                    let mut dirs = Vec::new();
                    let mut files = Vec::new();
                    for entry in entries {
                        if let Ok(e) = entry {
                            let path = e.path();
                            if path.is_dir() {
                                dirs.push(path);
                            } else {
                                files.push(path);
                            }
                        }
                    }
                    eprintln!("  - Found {} subdirectory(ies) and {} file(s):", dirs.len(), files.len());
                    for dir in dirs.iter().take(5) {
                        eprintln!("    - [DIR] {}", dir.display());
                        // Check files inside the directory (for multi-file torrents)
                        if let Ok(sub_entries) = std::fs::read_dir(dir) {
                            let sub_files: Vec<_> = sub_entries.filter_map(|e| e.ok()).take(5).collect();
                            eprintln!("      ({} files inside)", sub_files.len());
                        }
                    }
                    for file in files.iter().take(5) {
                        if let Ok(metadata) = std::fs::metadata(file) {
                            eprintln!("    - [FILE] {} ({} bytes)", file.display(), metadata.len());
                        }
                    }
                    if dirs.is_empty() && files.is_empty() {
                        eprintln!("  - ⚠️  WARNING: Output directory exists but is empty!");
                    }
                } else {
                    eprintln!("  - ⚠️  ERROR: Cannot read output directory");
                }
            } else {
                eprintln!("  - ⚠️  WARNING: Output path exists but is not a directory: {}", expanded_output);
            }
        } else {
            eprintln!("  - ⚠️  WARNING: Output directory does not exist: {}", expanded_output);
            // Check if parent directory exists
            if let Some(parent) = output_path.parent() {
                eprintln!("  - Parent directory exists: {}", parent.exists());
                if parent.exists() {
                    eprintln!("  - Parent directory contents:");
                    if let Ok(entries) = std::fs::read_dir(parent) {
                        for entry in entries.take(10) {
                            if let Ok(e) = entry {
                                eprintln!("    - {}", e.path().display());
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Find and verify Go binary
    let go_binary = utils::find_go_binary()
        .ok_or_else(|| {
            eprintln!("[resume-download] Failed to find Go binary. Tried:");
            eprintln!("  - Bundled location");
            eprintln!("  - Project bin directory");
            eprintln!("  - PATH");
            "Go binary (api-wrapper) not found. Please ensure the binary is built and available.".to_string()
        })?;
    
    eprintln!("[resume-download] Found Go binary at: {}", go_binary.display());
    
    let verified_binary = utils::verify_binary_path(&go_binary)
        .map_err(|e| format!("Binary verification failed: {}", e))?;
    
    // Update database FIRST
    let mut updated_metadata = metadata.clone();
    updated_metadata["auto_paused"] = serde_json::json!(false);
    updated_metadata["pause_reason"] = serde_json::Value::Null;
    updated_metadata["paused_at"] = serde_json::Value::Null;
    
    conn.execute(
        "UPDATE downloads SET status = ?, metadata = ? WHERE id = ?",
        rusqlite::params!["downloading", serde_json::to_string(&updated_metadata).unwrap(), download_id],
    )
    .map_err(|e| format!("Failed to update download: {}", e))?;
    
    // Emit update with restored progress BEFORE starting the Go binary
    // This ensures the frontend has the correct progress before the Go binary sends any updates
    app.emit("download-update", serde_json::json!({
        "downloadId": download_id,
        "download_id": download_id,
        "status": "downloading",
        "progress": existing_progress,
        "downloaded": existing_downloaded,
        "total": existing_total,
        "restored": true, // Flag to indicate this is restored progress
    }))
    .map_err(|e| format!("Failed to emit event: {}", e))?;
    
    // Small delay to ensure the frontend processes the restored progress before Go binary starts
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    
    let working_dir = utils::get_working_directory();
    
    // NOW spawn the Go binary process
    use crate::logger;
    logger::log_info("resume_download", &format!("Spawning Go binary: {}", verified_binary.display()));
    logger::log_info("resume_download", &format!("Working directory: {}", working_dir.display()));
    logger::log_info("resume_download", &format!("Command args: {:?}", args));
    
    let child = TokioCommand::new(&verified_binary)
        .args(&args)
        .current_dir(&working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            let error_msg = format!("Failed to spawn process: {}", e);
            logger::log_error("resume_download", &error_msg);
            error_msg
        })?;
    
    logger::log_info("resume_download", &format!("✓ Go binary spawned successfully for download: {}", download_id));
    
    // Store process
    processes.insert(download_id.clone(), child);
    drop(processes);
    
    // Re-acquire to get child for monitoring
    let mut processes_for_monitor = DOWNLOAD_PROCESSES.lock().await;
    if let Some(mut child) = processes_for_monitor.remove(&download_id) {
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        processes_for_monitor.insert(download_id.clone(), child);
        drop(processes_for_monitor);
        
        logger::log_info("resume_download", &format!("Starting monitoring task for download: {}", download_id));
        
        // Start monitoring task
        let app_clone = app.clone();
        let download_id_clone = download_id.clone();
        tokio::spawn(async move {
            download::monitor_download_process_with_streams(app_clone, download_id_clone, stdout, stderr).await;
        });
    } else {
        logger::log_error("resume_download", &format!("Failed to retrieve process from map for monitoring: {}", download_id));
    }
    
    Ok(())
}

// Handler 7: resume-download
#[command]
pub async fn resume_download(
    download_id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    resume_download_internal(download_id, app).await
}

// Handler 8: get-active-downloads
#[command]
pub async fn get_active_downloads() -> Result<Vec<serde_json::Value>, String> {
    let conn = database::get_connection()
        .map_err(|e| format!("Database error: {}", e))?;
    
    let mut stmt = conn.prepare(
        "SELECT * FROM downloads WHERE status NOT IN ('completed', 'cancelled') ORDER BY started_at DESC"
    )
    .map_err(|e| format!("Failed to prepare statement: {}", e))?;
    
    let rows = stmt.query_map([], |row| {
        // Column order: id(0), source(1), output(2), type(3), status(4), progress(5), 
        // downloaded(6), total(7), speed(8), error(9), metadata(10), started_at(11), updated_at(12)
        // metadata can be NULL, so handle it as Option
        let metadata_str: Option<String> = row.get(10).ok();
        let metadata: serde_json::Value = if let Some(ref s) = metadata_str {
            serde_json::from_str(s).unwrap_or_else(|_| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };
        
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "source": row.get::<_, String>(1)?,
            "output": row.get::<_, String>(2)?,
            "type": row.get::<_, String>(3)?,
            "status": row.get::<_, String>(4)?,
            "progress": row.get::<_, f64>(5)?,
            "downloaded": row.get::<_, i64>(6)?,
            "total": row.get::<_, i64>(7)?,
            "speed": row.get::<_, i64>(8)?,
            "error": row.get::<_, Option<String>>(9)?,
            "metadata": metadata,
            "startedAt": row.get::<_, Option<i64>>(11)?,
            "updatedAt": row.get::<_, Option<i64>>(12)?,
        }))
    })
    .map_err(|e| format!("Failed to query: {}", e))?;
    
    let mut downloads = Vec::new();
    for row in rows {
        downloads.push(row.map_err(|e| format!("Failed to process row: {}", e))?);
    }
    
    Ok(downloads)
}

// Handler 9: get-download-history
#[command]
pub async fn get_download_history() -> Result<Vec<serde_json::Value>, String> {
    let conn = database::get_connection()
        .map_err(|e| format!("Database error: {}", e))?;
    
    // Get history items
    let mut stmt = conn.prepare(
        "SELECT * FROM download_history ORDER BY completed_at DESC LIMIT 100"
    )
    .map_err(|e| format!("Failed to prepare statement: {}", e))?;
    
    let mut history_map: std::collections::HashMap<String, serde_json::Value> = std::collections::HashMap::new();
    
    let rows = stmt.query_map([], |row| {
        // Column order: id(0), source(1), output(2), type(3), size(4), metadata(5), completed_at(6)
        // metadata can be NULL, so handle it as Option
        let metadata_str: Option<String> = row.get(5).ok();
        let metadata: serde_json::Value = if let Some(ref s) = metadata_str {
            serde_json::from_str(s).unwrap_or_else(|_| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };
        
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "source": row.get::<_, String>(1)?,
            "output": row.get::<_, String>(2)?,
            "type": row.get::<_, String>(3)?,
            "size": row.get::<_, Option<i64>>(4)?,
            "completedAt": row.get::<_, Option<i64>>(6)?,
            "metadata": metadata,
            "isSeeding": false,
        }))
    })
    .map_err(|e| format!("Failed to query: {}", e))?;

    // Process history rows - use iterator for efficiency
    // HashMap automatically handles duplicates by overwriting
    for row in rows {
        if let Ok(item) = row {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                history_map.insert(id.to_string(), item);
            }
        }
    }
    
    // Also include active seeding torrents
    let mut stmt2 = conn.prepare(
        "SELECT d.*, h.completed_at FROM downloads d
         LEFT JOIN download_history h ON d.id = h.id
         WHERE d.status = 'seeding' AND d.type = 'torrent'
         ORDER BY h.completed_at DESC, d.started_at DESC"
    )
    .map_err(|e| format!("Failed to prepare statement: {}", e))?;
    
    let rows2 = stmt2.query_map([], |row| {
        // Column order from JOIN: d.id(0), d.source(1), d.output(2), d.type(3), d.status(4), 
        // d.progress(5), d.downloaded(6), d.total(7), d.speed(8), d.error(9), d.metadata(10), 
        // d.started_at(11), d.updated_at(12), h.completed_at(13)
        // metadata can be NULL, so handle it as Option
        let metadata_str: Option<String> = row.get(10).ok();
        let metadata: serde_json::Value = if let Some(ref s) = metadata_str {
            serde_json::from_str(s).unwrap_or_else(|_| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };
        
        // h.completed_at can be NULL (LEFT JOIN), so handle it as Option
        let completed_at: Option<i64> = row.get(13).ok().flatten();
        
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "source": row.get::<_, String>(1)?,
            "output": row.get::<_, String>(2)?,
            "type": row.get::<_, String>(3)?,
            "status": "seeding",
            "progress": row.get::<_, f64>(5)?,
            "downloaded": row.get::<_, i64>(6)?,
            "total": row.get::<_, i64>(7)?,
            "speed": row.get::<_, i64>(8)?,
            "completedAt": completed_at,
            "metadata": metadata,
            "isSeeding": true,
        }))
    })
    .map_err(|e| format!("Failed to query: {}", e))?;
    
    // Process seeding rows - HashMap automatically handles duplicates (overwrites)
    for row in rows2 {
        if let Ok(item) = row {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                history_map.insert(id.to_string(), item);
            }
        }
    }
    
    Ok(history_map.values().cloned().collect())
}

// Handler 10: clear-download-history
#[command]
pub async fn clear_download_history() -> Result<(), String> {
    let conn = database::get_connection()
        .map_err(|e| format!("Database error: {}", e))?;
    
    conn.execute("DELETE FROM download_history", [])
        .map_err(|e| format!("Failed to clear history: {}", e))?;
    
    Ok(())
}

// Handler 11: get-junk-data-size
#[command]
pub async fn get_junk_data_size() -> Result<serde_json::Value, String> {
    use std::fs;
    
    let settings = get_settings().await.unwrap_or_default();
    let download_path = settings
        .get("defaultDownloadPath")
        .and_then(|v| v.as_str())
        .unwrap_or("~/Downloads");
    
    let path = PathBuf::from(download_path.replace("~", &dirs::home_dir().unwrap().to_string_lossy()));
    
    let mut total_size = 0u64;
    let mut junk_paths = Vec::new();
    
    if path.exists() {
        if let Ok(entries) = fs::read_dir(&path) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if name.starts_with(".accelara-temp-") {
                        if let Ok(metadata) = entry.metadata() {
                            if metadata.is_dir() {
                                let size = calculate_dir_size(entry.path()).unwrap_or(0);
                                total_size += size;
                                junk_paths.push(serde_json::json!({
                                    "path": entry.path().to_string_lossy(),
                                    "size": size,
                                }));
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(serde_json::json!({
        "size": total_size,
        "sizeFormatted": format_bytes(total_size),
        "paths": junk_paths,
    }))
}

fn calculate_dir_size(path: PathBuf) -> Result<u64, std::io::Error> {
    let mut total = 0u64;
    
    if path.is_dir() {
        for entry in fs::read_dir(&path)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_dir() {
                total += calculate_dir_size(path)?;
            } else {
                total += entry.metadata()?.len();
            }
        }
    } else {
        total += fs::metadata(&path)?.len();
    }
    
    Ok(total)
}

fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".to_string();
    }
    
    let k = 1024u64;
    let sizes = ["B", "KB", "MB", "GB", "TB"];
    let i = (bytes as f64).log(k as f64) as usize;
    let size = bytes as f64 / (k.pow(i as u32) as f64);
    
    format!("{:.2} {}", size, sizes[i])
}

// Handler 12: clear-junk-data
#[command]
pub async fn clear_junk_data() -> Result<serde_json::Value, String> {
    use std::fs;
    
    let settings = get_settings().await.unwrap_or_default();
    let download_path = settings
        .get("defaultDownloadPath")
        .and_then(|v| v.as_str())
        .unwrap_or("~/Downloads");
    
    let path = PathBuf::from(download_path.replace("~", &dirs::home_dir().unwrap().to_string_lossy()));
    
    let mut deleted_size = 0u64;
    let mut deleted_count = 0u64;
    
    if path.exists() {
        if let Ok(entries) = fs::read_dir(&path) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if name.starts_with(".accelara-temp-") {
                        if let Ok(metadata) = entry.metadata() {
                            if metadata.is_dir() {
                                let size = calculate_dir_size(entry.path()).unwrap_or(0);
                                if fs::remove_dir_all(entry.path()).is_ok() {
                                    deleted_size += size;
                                    deleted_count += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(serde_json::json!({
        "success": true,
        "deletedSize": deleted_size,
        "deletedSizeFormatted": format_bytes(deleted_size),
        "deletedCount": deleted_count,
    }))
}

// Handler 13: save-speed-test-result
#[command]
pub async fn save_speed_test_result(result: serde_json::Value) -> Result<String, String> {
    
    let test_id = format!("test_{}_{}", 
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
        nanoid::nanoid!(9)
    );
    
    let conn = database::get_connection()
        .map_err(|e| format!("Database error: {}", e))?;
    
    let latency = result.get("latency").and_then(|v| serde_json::to_string(v).ok());
    let location = result.get("location").and_then(|v| serde_json::to_string(v).ok());
    
    conn.execute(
        "INSERT INTO speed_test_results (id, timestamp, download_speed, upload_speed, latency, location)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            test_id,
            result.get("timestamp").and_then(|v| v.as_i64()).unwrap_or_else(|| SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64),
            result.get("downloadSpeed").and_then(|v| v.as_f64()).unwrap_or(0.0),
            result.get("uploadSpeed").and_then(|v| v.as_f64()).unwrap_or(0.0),
            latency,
            location,
        ],
    )
    .map_err(|e| format!("Failed to save speed test result: {}", e))?;
    
    Ok(test_id)
}

// Handler 14: get-speed-test-results
#[command]
pub async fn get_speed_test_results(limit: Option<usize>) -> Result<Vec<serde_json::Value>, String> {
    let limit = limit.unwrap_or(100);
    
    let conn = database::get_connection()
        .map_err(|e| format!("Database error: {}", e))?;
    
    let mut stmt = conn.prepare(
        &format!("SELECT * FROM speed_test_results ORDER BY timestamp DESC LIMIT {}", limit)
    )
    .map_err(|e| format!("Failed to prepare statement: {}", e))?;
    
    let rows = stmt.query_map([], |row| {
        // Column order: id(0), timestamp(1), download_speed(2), upload_speed(3), latency(4), location(5)
        // latency and location are TEXT, but may be NULL
        let latency_str: Option<String> = row.get(4).ok();
        let location_str: Option<String> = row.get(5).ok();
        
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "timestamp": row.get::<_, i64>(1)?,
            "downloadSpeed": row.get::<_, f64>(2)?,
            "uploadSpeed": row.get::<_, f64>(3)?,
            "latency": latency_str.and_then(|s| {
                // Try to parse as JSON first, otherwise return as string
                serde_json::from_str::<serde_json::Value>(&s).ok().or_else(|| {
                    Some(serde_json::Value::String(s))
                })
            }),
            "location": location_str.and_then(|s| {
                serde_json::from_str::<serde_json::Value>(&s).ok().or_else(|| {
                    Some(serde_json::Value::String(s))
                })
            }),
        }))
    })
    .map_err(|e| format!("Failed to query: {}", e))?;
    
    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("Failed to process row: {}", e))?);
    }
    
    Ok(results)
}

// Handler 15: clear-speed-test-results
#[command]
pub async fn clear_speed_test_results() -> Result<(), String> {
    let conn = database::get_connection()
        .map_err(|e| format!("Database error: {}", e))?;
    
    conn.execute("DELETE FROM speed_test_results", [])
        .map_err(|e| format!("Failed to clear speed test results: {}", e))?;
    
    Ok(())
}

// Handler 16: start-speed-test
#[command]
pub async fn start_speed_test(
    test_type: Option<String>,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    
    let test_id = format!("test_{}_{}", 
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
        nanoid::nanoid!(9)
    );
    
    let _test_type = test_type.unwrap_or_else(|| "full".to_string());
    
    // Find iris binary
    let iris_binary = utils::find_iris_binary()
        .ok_or_else(|| "Iris binary not found".to_string())?;
    
    let verified_binary = utils::verify_binary_path(&iris_binary)
        .map_err(|e| format!("Binary verification failed: {}", e))?;
    
    let working_dir = utils::get_working_directory();
    
    // Spawn iris process
    let child = TokioCommand::new(&verified_binary)
        .args(&["--json", "--quiet"])
        .current_dir(&working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn iris process: {}", e))?;
    
    // Store process
    let mut processes = SPEED_TEST_PROCESSES.lock().await;
    processes.insert(test_id.clone(), child);
    drop(processes); // Release lock before async operation
    
    // Start monitoring task
    let app_clone = app.clone();
    let test_id_clone = test_id.clone();
    tokio::spawn(async move {
        download::monitor_speed_test_process(app_clone, test_id_clone).await;
    });
    
    Ok(serde_json::json!({
        "testId": test_id,
        "success": true,
    }))
}

// Handler 17: stop-speed-test
#[command]
pub async fn stop_speed_test(test_id: String) -> Result<(), String> {
    let mut processes = SPEED_TEST_PROCESSES.lock().await;
    
    if let Some(mut child) = processes.remove(&test_id) {
        child.kill().await
            .map_err(|e| format!("Failed to kill process: {}", e))?;
    }
    
    Ok(())
}

// Handler 18: get-settings
#[command]
pub async fn get_settings() -> Result<serde_json::Value, String> {
    let conn = database::get_connection()
        .map_err(|e| format!("Database error: {}", e))?;
    
    let mut stmt = conn.prepare("SELECT key, value FROM settings")
        .map_err(|e| format!("Failed to prepare statement: {}", e))?;
    
    let mut settings = serde_json::json!({
        "concurrency": 8,
        "chunkSize": "4MB",
        "rateLimit": null,
        "uploadLimit": null,
        "sequentialMode": false,
        "keepSeeding": false,
        "theme": "system",
        "connectTimeout": 15,
        "readTimeout": 60,
        "retries": 5,
        "torrentPort": 42069,
        "defaultDownloadPath": dirs::download_dir()
            .unwrap_or_else(|| dirs::home_dir().unwrap().join("Downloads"))
            .to_string_lossy()
            .to_string(),
    });
    
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })
    .map_err(|e| format!("Failed to query: {}", e))?;
    
    for row in rows {
        let (key, value): (String, String) = row.map_err(|e| format!("Failed to process row: {}", e))?;
        
        // Try to parse as JSON, fallback to string
        if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(&value) {
            settings[&key] = json_value;
        } else {
            settings[&key] = serde_json::Value::String(value);
        }
    }
    
    Ok(settings)
}

// Handler 19: save-settings
#[command]
pub async fn save_settings(settings: serde_json::Value) -> Result<(), String> {
    let conn = database::get_connection()
        .map_err(|e| format!("Database error: {}", e))?;
    
    if let Some(obj) = settings.as_object() {
        for (key, value) in obj {
            let value_str = serde_json::to_string(value)
                .map_err(|e| format!("Failed to serialize value: {}", e))?;
            
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                rusqlite::params![key, value_str],
            )
            .map_err(|e| format!("Failed to save setting: {}", e))?;
        }
    }
    
    Ok(())
}

// Handler 20: select-torrent-file
#[command]
pub async fn select_torrent_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    
    let (tx, rx) = tokio::sync::oneshot::channel();
    
    app.dialog()
        .file()
        .add_filter("Torrent Files", &["torrent"])
        .add_filter("All Files", &["*"])
        .pick_file(move |file_path_opt| {
            let path_str = file_path_opt.and_then(|p| {
                p.as_path().map(|path| path.to_string_lossy().to_string())
            });
            let _ = tx.send(path_str);
        });
    
    match rx.await {
        Ok(Some(path)) => Ok(Some(path)),
        Ok(None) => Ok(None),
        Err(_) => Ok(None), // User cancelled
    }
}

// Handler 21: select-download-folder
#[command]
pub async fn select_download_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use std::path::PathBuf;
    
    let (tx, rx) = tokio::sync::oneshot::channel();
    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    
    app.dialog()
        .file()
        .set_directory(&home_dir)
        .pick_folder(move |folder_path_opt| {
            let path_str = folder_path_opt.and_then(|p| {
                p.as_path().map(|path| path.to_string_lossy().to_string())
            });
            let _ = tx.send(path_str);
        });
    
    match rx.await {
        Ok(Some(path)) => Ok(Some(path)),
        Ok(None) => Ok(None),
        Err(_) => Ok(None), // User cancelled
    }
}

// Handler 22: open-folder
#[command]
pub async fn open_folder(folder_path: String) -> Result<(), String> {
    // This will be handled by the shell plugin
    // For now, use system command
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder_path)
            .output()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .output()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder_path)
            .output()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    Ok(())
}

// Handler 23: get-system-theme
#[command]
pub async fn get_system_theme() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        // Use defaults read to check macOS appearance
        let output = Command::new("defaults")
            .args(&["read", "-g", "AppleInterfaceStyle"])
            .output();
        
        match output {
            Ok(result) if result.status.success() => {
                let theme = String::from_utf8_lossy(&result.stdout).trim().to_lowercase();
                if theme == "dark" {
                    return Ok("dark".to_string());
                }
            }
            _ => {
                // If command fails or returns nothing, it's light mode
                // (dark mode sets AppleInterfaceStyle, light mode doesn't)
            }
        }
        Ok("light".to_string())
    }
    
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let subkey = hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");
        
        match subkey {
            Ok(key) => {
                let apps_use_light_theme: Result<u32, _> = key.get_value("AppsUseLightTheme");
                match apps_use_light_theme {
                    Ok(0) => Ok("dark".to_string()),
                    Ok(1) => Ok("light".to_string()),
                    _ => Ok("light".to_string()),
                }
            }
            Err(_) => Ok("light".to_string()),
        }
    }
    
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        use std::env;
        
        // Try GTK settings first
        if let Ok(output) = Command::new("gsettings")
            .args(&["get", "org.gnome.desktop.interface", "gtk-theme"])
            .output()
        {
            if output.status.success() {
                let theme = String::from_utf8_lossy(&output.stdout).to_lowercase();
                if theme.contains("dark") {
                    return Ok("dark".to_string());
                }
            }
        }
        
        // Fallback: check environment variable
        if let Ok(theme) = env::var("GTK_THEME") {
            if theme.to_lowercase().contains("dark") {
                return Ok("dark".to_string());
            }
        }
        
        // Default to light
        Ok("light".to_string())
    }
    
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Ok("light".to_string())
    }
}

// Handler 24: show-window (for restoring hidden window)
#[command]
pub async fn show_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| format!("Failed to show window: {}", e))?;
        window.set_focus().map_err(|e| format!("Failed to focus window: {}", e))?;
    }
    Ok(())
}

// Handler 25: quit-app
#[command]
pub async fn quit_app(app: tauri::AppHandle) -> Result<(), String> {
    // Stop all downloads before quitting
    let mut processes = DOWNLOAD_PROCESSES.lock().await;
    for (download_id, mut child) in processes.drain() {
        eprintln!("[quit-app] Stopping download: {}", download_id);
        let _ = child.kill().await;
    }
    drop(processes);
    
    // Stop all speed tests
    let mut speed_test_processes = SPEED_TEST_PROCESSES.lock().await;
    for (test_id, mut child) in speed_test_processes.drain() {
        eprintln!("[quit-app] Stopping speed test: {}", test_id);
        let _ = child.kill().await;
    }
    drop(speed_test_processes);
    
    // Update all active downloads to paused status
    if let Ok(conn) = database::get_connection() {
        let _ = conn.execute(
            "UPDATE downloads SET status = 'paused' WHERE status = 'downloading'",
            [],
        );
    }
    
    // Actually quit the app
    app.exit(0);
    Ok(())
}

// Handler 26: get-log-path
#[command]
pub async fn get_log_path() -> Result<String, String> {
    use dirs::home_dir;
    
    if let Some(home) = home_dir() {
        let log_dir = home.join(".accelara");
        let log_path = log_dir.join("accelara.log");
        Ok(log_path.to_string_lossy().to_string())
    } else {
        Err("Could not determine home directory".to_string())
    }
}

// Handler 28: open-debug-log-window
#[command]
pub async fn open_debug_log_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    
    // Check if window already exists
    if let Some(window) = app.get_webview_window("debug-logs") {
        window.show().map_err(|e| format!("Failed to show window: {}", e))?;
        window.set_focus().map_err(|e| format!("Failed to focus window: {}", e))?;
        return Ok(());
    }
    
    // Window is defined in tauri.conf.json, just show it
    // If it doesn't exist, it will be created automatically from the config
    let window = app.get_webview_window("debug-logs")
        .ok_or_else(|| "Debug log window not found. It should be defined in tauri.conf.json".to_string())?;
    
    window.show().map_err(|e| format!("Failed to show window: {}", e))?;
    window.set_focus().map_err(|e| format!("Failed to focus window: {}", e))?;
    
    Ok(())
}

// Handler 27: get-recent-logs
#[command]
pub async fn get_recent_logs(lines: Option<usize>) -> Result<Vec<String>, String> {
    use dirs::home_dir;
    use std::fs;
    use std::io::{BufRead, BufReader};
    
    let num_lines = lines.unwrap_or(50);
    
    if let Some(home) = home_dir() {
        let log_dir = home.join(".accelara");
        let log_path = log_dir.join("accelara.log");
        
        if !log_path.exists() {
            return Ok(vec!["No log file found yet.".to_string()]);
        }
        
        if let Ok(file) = fs::File::open(&log_path) {
            let reader = BufReader::new(file);
            let all_lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();
            let start = if all_lines.len() > num_lines {
                all_lines.len() - num_lines
            } else {
                0
            };
            Ok(all_lines[start..].to_vec())
        } else {
            Err("Failed to read log file".to_string())
        }
    } else {
        Err("Could not determine home directory".to_string())
    }
}
