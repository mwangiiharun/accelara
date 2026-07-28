use crate::commands::DOWNLOAD_PROCESSES;
use crate::database;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::Mutex;

/// Set up download handlers to parse Go process output and emit events
pub fn setup_download_handlers(_app: &mut tauri::App) {
    // Start periodic progress saving task
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5)); // Save every 5 seconds
        loop {
            interval.tick().await;
            
            // Save all cached progress to database
            let mut cache = PROGRESS_CACHE.lock().await;
            let mut to_remove = Vec::new();
            
            for (download_id, (progress, downloaded, total, speed, last_update)) in cache.iter() {
                // Only save if updated within last 30 seconds (download is still active)
                if last_update.elapsed() < Duration::from_secs(30) {
                    save_progress_to_db(download_id, *progress, *downloaded, *total, *speed);
                } else {
                    // Remove stale entries (downloads that haven't updated in 30 seconds)
                    to_remove.push(download_id.clone());
                }
            }
            
            // Remove stale entries
            for id in to_remove {
                cache.remove(&id);
            }
        }
    });
    
    // Save all progress on app exit - use setup hook
    // Note: Tauri doesn't have a direct shutdown hook, so we rely on periodic saves
    // The periodic save every 5 seconds ensures we don't lose much data on crash
}

/// Spawn a task to monitor a download process and emit events
/// Note: Currently unused, kept for potential future use
#[allow(dead_code)]
pub fn monitor_download_process(
    app: AppHandle,
    download_id: String,
    mut child: Child,
) {
    tokio::spawn(async move {
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        
        if let Some(stdout) = stdout {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            
            while let Ok(n) = reader.read_line(&mut line).await {
                if n == 0 {
                    break; // EOF
                }
                
                // Try to parse JSON from stdout
                if let Ok(json) = serde_json::from_str::<Value>(line.trim()) {
                    // Emit download update event
                    let _ = app.emit("download-update", json);
                }
                
                line.clear();
            }
        }
        
        if let Some(stderr) = stderr {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            
            while let Ok(n) = reader.read_line(&mut line).await {
                if n == 0 {
                    break;
                }
                
                // Log errors but don't emit as updates
                eprintln!("[{}] Error: {}", download_id, line.trim());
                line.clear();
            }
        }
        
        // Wait for process to complete
        let status = child.wait().await;
        
        // Update database with final status
        let success = status.as_ref().map(|s| s.success()).unwrap_or(false);
        let final_status = if success {
            "completed"
        } else {
            "error"
        };
        
        if let Ok(conn) = database::get_connection() {
            let _ = conn.execute(
                "UPDATE downloads SET status = ? WHERE id = ?",
                rusqlite::params![final_status, download_id],
            );
        }
        
        // Emit completion event
        let _ = app.emit("download-complete", serde_json::json!({
            "downloadId": download_id,
            "download_id": download_id,
            "success": success,
        }));
        
        // Remove from process map
        let mut processes = DOWNLOAD_PROCESSES.lock().await;
        processes.remove(&download_id);
    });
}

// Global map to store latest progress for periodic saving
lazy_static::lazy_static! {
    static ref PROGRESS_CACHE: Arc<Mutex<HashMap<String, (f64, i64, i64, i64, Instant)>>> = 
        Arc::new(Mutex::new(HashMap::new()));
}

// Helper function to save progress to database
fn save_progress_to_db(download_id: &str, progress: f64, downloaded: i64, total: i64, speed: i64) {
    if let Ok(conn) = database::get_connection() {
        let _ = conn.execute(
            "UPDATE downloads SET progress = ?, downloaded = ?, total = ?, speed = ?, updated_at = ? WHERE id = ?",
            rusqlite::params![
                progress,
                downloaded,
                total,
                speed,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
                download_id,
            ],
        );
    }
}

/// Monitor download process with pre-captured stdout/stderr
pub async fn monitor_download_process_with_streams(
    app: AppHandle,
    download_id: String,
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
    download_type: String,
    output_dir: String,
) {
    use crate::logger;
    logger::log_info("monitor_download", &format!("Starting to monitor download: {}", download_id));

    let is_torrent = download_type == "torrent" || download_type == "magnet";
    let mut watching_seed = false;

    if let Some(stdout) = stdout {
        logger::log_info("monitor_download", &format!("[{}] stdout stream available", download_id));
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        
        while let Ok(n) = reader.read_line(&mut line).await {
            if n == 0 {
                logger::log_info("monitor_download", &format!("[{}] stdout stream closed (EOF)", download_id));
                break;
            }
            
            logger::log_info("monitor_download", &format!("[{}] Received line: {}", download_id, line.trim()));
            
            if let Ok(json) = serde_json::from_str::<Value>(line.trim()) {
                // Extract progress data and cache it for periodic saving
                if let (Some(download_id_val), Some(progress), Some(downloaded), Some(total), Some(speed)) = (
                    json.get("download_id").or_else(|| json.get("downloadId")),
                    json.get("progress").and_then(|v| v.as_f64()),
                    json.get("downloaded").and_then(|v| v.as_i64()),
                    json.get("total").and_then(|v| v.as_i64()),
                    json.get("speed").and_then(|v| v.as_i64()),
                ) {
                    let id_str = download_id_val.as_str().unwrap_or(&download_id);
                    
                    // Check if we should prevent saving 0 progress when there's existing progress
                    let should_prevent_zero_save = if downloaded == 0 {
                        if let Ok(conn) = database::get_connection() {
                            if let Ok(existing_downloaded) = conn.query_row(
                                "SELECT downloaded FROM downloads WHERE id = ?1",
                                [id_str],
                                |row| row.get::<_, i64>(0),
                            ) {
                                existing_downloaded > 0
                            } else {
                                false
                            }
                        } else {
                            false
                        }
                    } else {
                        false
                    };
                    
                    if should_prevent_zero_save {
                        // There's existing progress, don't overwrite with 0
                        eprintln!("[monitor] Ignoring 0 progress update for {} (existing progress in DB)", id_str);
                        // Still emit the update so frontend can handle it, but don't save to DB
                        let _ = app.emit("download-update", json);
                        line.clear();
                        continue;
                    }
                    
                    // Update cache with latest progress
                    let mut cache = PROGRESS_CACHE.lock().await;
                    let prev_progress = cache.get(id_str).map(|(p, _, _, _, _)| *p);
                    let prev_downloaded = cache.get(id_str).map(|(_, d, _, _, _)| *d);
                    cache.insert(id_str.to_string(), (progress, downloaded, total, speed, Instant::now()));
                    drop(cache);
                    
                    // Save immediately if progress changed significantly (>1% or >1MB)
                    let should_save_immediately = if let (Some(pp), Some(pd)) = (prev_progress, prev_downloaded) {
                        let progress_diff = (progress - pp).abs();
                        let downloaded_diff = (downloaded - pd).abs();
                        progress_diff > 1.0 || downloaded_diff > 1_000_000 // >1% or >1MB
                    } else {
                        true // First update, always save (we already checked for 0 above)
                    };
                    
                    if should_save_immediately {
                        save_progress_to_db(id_str, progress, downloaded, total, speed);
                    }
                }

                // Start watching the seeded file/folder for external moves the
                // first time this process reports it's seeding. In-memory only -
                // seeding is a live/display concept, nothing here touches the DB.
                if is_torrent && !watching_seed {
                    if json.get("status").and_then(|v| v.as_str()) == Some("seeding") {
                        if let Some(torrent_name) = json.get("torrent_name").and_then(|v| v.as_str()) {
                            let tracked_path = std::path::Path::new(&output_dir).join(torrent_name);
                            crate::monitor::start_watching(&download_id, &tracked_path).await;
                            watching_seed = true;
                        }
                    }
                }

                // Emit update event
                let _ = app.emit("download-update", json);
            }
            
            line.clear();
        }
    }
    
    if let Some(stderr) = stderr {
        logger::log_info("monitor_download", &format!("[{}] stderr stream available", download_id));
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        
        while let Ok(n) = reader.read_line(&mut line).await {
            if n == 0 {
                logger::log_info("monitor_download", &format!("[{}] stderr stream closed (EOF)", download_id));
                break;
            }
            
            logger::log_error("monitor_download", &format!("[{}] stderr: {}", download_id, line.trim()));
            line.clear();
        }
    } else {
        logger::log_warning("monitor_download", &format!("[{}] stderr stream not available", download_id));
    }
    
    // Wait for process to complete
    let status = {
        let mut processes = DOWNLOAD_PROCESSES.lock().await;
        if let Some(mut child) = processes.remove(&download_id) {
            drop(processes);
            child.wait().await
        } else {
            return;
        }
    };
    
    let success = status.as_ref().map(|s| s.success()).unwrap_or(false);
    let final_status = if success { "completed" } else { "error" };
    
    // For HTTP downloads, verify the final file exists (not a .part file)
    // Note: Torrents don't use .part files - the torrent library writes directly to final locations
    // The Go code should have merged chunks and moved the file, but we need to verify
    if success {
        if let Ok(conn) = database::get_connection() {
            if let Ok((output, download_type)) = conn.query_row(
                "SELECT output, type FROM downloads WHERE id = ?1",
                [&download_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            ) {
                use crate::utils;
                let expanded_output = utils::expand_path(&output);
                let output_path = std::path::Path::new(&expanded_output);
                
                if download_type == "http" || download_type == "https" {
                    // HTTP downloads: Check if final file exists (not a .part file)
                    let final_file_exists = output_path.exists() && output_path.is_file();
                    
                    // Check if there are still .part files (chunks not merged)
                    let mut has_part_files = false;
                    if let Some(parent) = output_path.parent() {
                        if let Some(file_name) = output_path.file_name() {
                            let temp_dir_name = format!(".accelara-temp-{}", file_name.to_string_lossy());
                            let temp_dir = parent.join(&temp_dir_name);
                            if temp_dir.exists() {
                                if let Ok(entries) = std::fs::read_dir(&temp_dir) {
                                    for entry in entries.flatten() {
                                        let path = entry.path();
                                        if path.to_string_lossy().contains(".part.") {
                                            has_part_files = true;
                                            eprintln!("[monitor] Warning: Found unmerged chunk file: {}", path.display());
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    // If final file doesn't exist but we have part files, assembly may have failed
                    if !final_file_exists && has_part_files {
                        eprintln!("[monitor] Error: Download completed but final file doesn't exist and chunks are still present!");
                        eprintln!("[monitor] Expected final file: {}", expanded_output);
                        eprintln!("[monitor] This suggests the Go binary's assemble() function may have failed.");
                        // Mark as error instead of completed
                        if let Ok(conn) = database::get_connection() {
                            let _ = conn.execute(
                                "UPDATE downloads SET status = ?, error = ? WHERE id = ?",
                                rusqlite::params![
                                    "error",
                                    "Download completed but file assembly failed. Chunk files remain unmerged.",
                                    download_id
                                ],
                            );
                        }
                        let _ = app.emit("download-complete", serde_json::json!({
                            "downloadId": download_id,
                            "download_id": download_id,
                            "success": false,
                            "error": "File assembly failed - chunks not merged",
                        }));
                        return;
                    } else if !final_file_exists {
                        eprintln!("[monitor] Warning: Download completed but final file doesn't exist: {}", expanded_output);
                        eprintln!("[monitor] Attempting to find file in parent directory...");
                        // Try to find the file in the parent directory
                        if let Some(parent) = output_path.parent() {
                            if let Ok(entries) = std::fs::read_dir(parent) {
                                for entry in entries.flatten() {
                                    let path = entry.path();
                                    if path.is_file() {
                                        if let Some(name) = path.file_name() {
                                            if name == output_path.file_name().unwrap_or_default() {
                                                eprintln!("[monitor] Found file at: {}", path.display());
                                                // Update output path in database
                                                if let Ok(conn) = database::get_connection() {
                                                    let _ = conn.execute(
                                                        "UPDATE downloads SET output = ? WHERE id = ?",
                                                        rusqlite::params![path.to_string_lossy().to_string(), download_id],
                                                    );
                                                }
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        eprintln!("[monitor] ✓ HTTP download completed successfully: {}", expanded_output);
                    }
                } else if download_type == "torrent" || download_type == "magnet" {
                    // Torrent downloads: Check if files exist in the output directory
                    // The torrent library may write files with .part extensions that need to be renamed
                    fn remove_part_extensions(dir: &std::path::Path) -> Result<(), std::io::Error> {
                        if !dir.exists() {
                            return Ok(());
                        }
                        
                        let mut renamed_count = 0;
                        let entries = std::fs::read_dir(dir)?;
                        for entry in entries {
                            let entry = entry?;
                            let path = entry.path();
                            
                            if path.is_dir() {
                                // Recursively check subdirectories
                                remove_part_extensions(&path)?;
                            } else if path.is_file() {
                                // Check if file has .part extension
                                if let Some(file_name) = path.file_name() {
                                    let file_name_str = file_name.to_string_lossy();
                                    if file_name_str.ends_with(".part") {
                                        // Remove .part extension
                                        let new_path = path.parent()
                                            .unwrap_or_else(|| std::path::Path::new("."))
                                            .join(&file_name_str[..file_name_str.len() - 5]);
                                        
                                        // Check if target already exists
                                        if !new_path.exists() {
                                            if let Err(e) = std::fs::rename(&path, &new_path) {
                                                eprintln!("[monitor] Failed to rename {} to {}: {}", 
                                                    path.display(), new_path.display(), e);
                                            } else {
                                                renamed_count += 1;
                                                eprintln!("[monitor] Renamed {} to {}", 
                                                    path.display(), new_path.display());
                                            }
                                        } else {
                                            // Target exists, remove .part file
                                            if let Err(e) = std::fs::remove_file(&path) {
                                                eprintln!("[monitor] Failed to remove .part file {}: {}", 
                                                    path.display(), e);
                                            } else {
                                                eprintln!("[monitor] Removed .part file {} (target already exists)", 
                                                    path.display());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        
                        if renamed_count > 0 {
                            eprintln!("[monitor] Renamed {} .part file(s) in {}", renamed_count, dir.display());
                        }
                        
                        Ok(())
                    }
                    
                    if output_path.exists() {
                        if output_path.is_dir() {
                            // Multi-file torrent - check if directory has files and remove .part extensions
                            remove_part_extensions(&output_path).unwrap_or_else(|e| {
                                eprintln!("[monitor] Error removing .part extensions: {}", e);
                            });
                            
                            let mut has_files = false;
                            if let Ok(entries) = std::fs::read_dir(output_path) {
                                for entry in entries.flatten() {
                                    let path = entry.path();
                                    if path.is_file() || path.is_dir() {
                                        has_files = true;
                                        break;
                                    }
                                }
                            }
                            if has_files {
                                eprintln!("[monitor] ✓ Torrent download completed successfully in: {}", expanded_output);
                            } else {
                                eprintln!("[monitor] Warning: Torrent directory exists but is empty: {}", expanded_output);
                            }
                        } else {
                            // Single-file torrent - check if it has .part extension
                            if output_path.is_file() {
                                if let Some(file_name) = output_path.file_name() {
                                    let file_name_str = file_name.to_string_lossy();
                                    if file_name_str.ends_with(".part") {
                                        // Remove .part extension
                                        let new_path = output_path.parent()
                                            .unwrap_or_else(|| std::path::Path::new("."))
                                            .join(&file_name_str[..file_name_str.len() - 5]);
                                        
                                        if !new_path.exists() {
                                            if let Err(e) = std::fs::rename(&output_path, &new_path) {
                                                eprintln!("[monitor] Failed to rename {} to {}: {}", 
                                                    output_path.display(), new_path.display(), e);
                                            } else {
                                                eprintln!("[monitor] Renamed {} to {}", 
                                                    output_path.display(), new_path.display());
                                                // Update output path in database
                                                if let Ok(conn) = database::get_connection() {
                                                    let _ = conn.execute(
                                                        "UPDATE downloads SET output = ? WHERE id = ?",
                                                        rusqlite::params![new_path.to_string_lossy().to_string(), download_id],
                                                    );
                                                }
                                            }
                                        } else {
                                            // Target exists, remove .part file
                                            if let Err(e) = std::fs::remove_file(&output_path) {
                                                eprintln!("[monitor] Failed to remove .part file {}: {}", 
                                                    output_path.display(), e);
                                            } else {
                                                eprintln!("[monitor] Removed .part file {} (target already exists)", 
                                                    output_path.display());
                                            }
                                        }
                                    }
                                }
                                eprintln!("[monitor] ✓ Torrent download completed successfully: {}", expanded_output);
                            } else {
                                eprintln!("[monitor] Warning: Torrent file path exists but is not a file: {}", expanded_output);
                            }
                        }
                    } else {
                        eprintln!("[monitor] Warning: Torrent output path doesn't exist: {}", expanded_output);
                        // For torrents, the actual files might be in a subdirectory
                        // The Go code creates a folder with the torrent name inside the output directory
                        if let Some(parent) = output_path.parent() {
                            if let Ok(entries) = std::fs::read_dir(parent) {
                                for entry in entries.flatten() {
                                    let path = entry.path();
                                    if path.is_dir() {
                                        eprintln!("[monitor] Found potential torrent directory: {}", path.display());
                                        // Check and remove .part extensions in this directory
                                        remove_part_extensions(&path).unwrap_or_else(|e| {
                                            eprintln!("[monitor] Error removing .part extensions from {}: {}", 
                                                path.display(), e);
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Move completed download to history
    if success {
        if let Ok(conn) = database::get_connection() {
            // Get download info from database
            if let Ok((source, output, download_type, downloaded, total, metadata)) = conn.query_row(
                "SELECT source, output, type, downloaded, total, metadata FROM downloads WHERE id = ?1",
                [&download_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?, // source
                        row.get::<_, String>(1)?, // output
                        row.get::<_, String>(2)?, // type
                        row.get::<_, i64>(3)?,     // downloaded
                        row.get::<_, i64>(4)?,     // total
                        row.get::<_, Option<String>>(5)?, // metadata
                    ))
                },
            ) {
                // Use total if available, otherwise use downloaded
                let file_size = if total > 0 { total } else { downloaded };
                
                // Check if already in history (avoid duplicates)
                let exists = conn.query_row(
                    "SELECT COUNT(*) FROM download_history WHERE id = ?1",
                    [&download_id],
                    |row| row.get::<_, i64>(0),
                ).unwrap_or(0) > 0;
                
                if !exists {
                    // Insert into download_history
                    let completed_at = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs() as i64;
                    
                    let _ = conn.execute(
                        "INSERT INTO download_history (id, source, output, type, size, completed_at, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        rusqlite::params![
                            download_id,
                            source,
                            output,
                            download_type,
                            file_size,
                            completed_at,
                            metadata.unwrap_or_default(),
                        ],
                    );
                }
            }
        }
    }
    
    if let Ok(conn) = database::get_connection() {
        // Update status in downloads table
        let _ = conn.execute(
            "UPDATE downloads SET status = ? WHERE id = ?",
            rusqlite::params![final_status, download_id],
        );
        
        // For completed downloads, update status but keep in downloads table for history
        // The history table is separate and tracks completed downloads
        // We keep completed downloads in the downloads table with "completed" status
        // so they can be shown in the UI until explicitly removed
        if success {
            // Status is already updated to "completed" above
            // History entry is already created above
            // No need to delete from downloads table - keep it for UI display
        }
    }
    
    let _ = app.emit("download-complete", serde_json::json!({
        "downloadId": download_id,
        "download_id": download_id,
        "success": success,
    }));
}

/// Monitor speed test process
pub async fn monitor_speed_test_process(
    app: AppHandle,
    test_id: String,
) {
    use crate::commands::SPEED_TEST_PROCESSES;

    // Get stdout/stderr from the stored process
    let (stdout, stderr) = {
        let mut processes = SPEED_TEST_PROCESSES.lock().await;
        if let Some(child) = processes.get_mut(&test_id) {
            (child.stdout.take(), child.stderr.take())
        } else {
            return; // Process not found
        }
    };

    tokio::spawn(async move {
        // The Go binary streams one JSON object per line as the test
        // actually progresses (real periodic latency/throughput samples),
        // so we forward each line live instead of waiting for the whole
        // process to finish before showing anything.
        let mut latest_download: f64 = 0.0;
        let mut latest_upload: f64 = 0.0;
        let mut latest_latency: Value = Value::Null;
        let mut saw_any_line = false;

        if let Some(stdout) = stdout {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();

            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        if let Ok(json) = serde_json::from_str::<Value>(trimmed) {
                            saw_any_line = true;

                            if let Some(d) = json.get("download_speed").and_then(|v| v.as_f64()) {
                                if d > 0.0 {
                                    latest_download = d;
                                }
                            }
                            if let Some(u) = json.get("upload_speed").and_then(|v| v.as_f64()) {
                                if u > 0.0 {
                                    latest_upload = u;
                                }
                            }
                            if let Some(lat) = json.get("latency") {
                                if !lat.is_null() {
                                    latest_latency = lat.clone();
                                }
                            }

                            // Forward immediately, adding camelCase aliases
                            // for the frontend's flexible field lookups.
                            let mut event = json.clone();
                            if let Some(d) = json.get("download_speed").cloned() {
                                event["downloadSpeed"] = d;
                            }
                            if let Some(u) = json.get("upload_speed").cloned() {
                                event["uploadSpeed"] = u;
                            }
                            let _ = app.emit("speed-test-update", event);
                        } else {
                            eprintln!("[speed-test {}] Non-JSON line: {}", test_id, trimmed);
                        }
                    }
                    Err(e) => {
                        eprintln!("[speed-test {}] stdout read error: {}", test_id, e);
                        break;
                    }
                }
            }
        }

        let mut stderr_buf = String::new();
        if let Some(mut stderr) = stderr {
            use tokio::io::AsyncReadExt;
            let _ = stderr.read_to_string(&mut stderr_buf).await;
        }

        let status = {
            let mut processes = SPEED_TEST_PROCESSES.lock().await;
            if let Some(mut child) = processes.remove(&test_id) {
                drop(processes);
                child.wait().await
            } else {
                return;
            }
        };

        let success = status.as_ref().map(|s| s.success()).unwrap_or(false);

        if !success || !saw_any_line {
            let error_msg = if !stderr_buf.trim().is_empty() {
                format!("Speed test failed: {}", stderr_buf.trim())
            } else {
                "Speed test produced no results. Check your network connection.".to_string()
            };
            let _ = app.emit("speed-test-error", serde_json::json!({
                "testId": test_id,
                "error": error_msg,
            }));
            let _ = app.emit("speed-test-complete", serde_json::json!({
                "testId": test_id,
                "code": status.map(|s| s.code().unwrap_or(1)).unwrap_or(1),
            }));
            return;
        }

        let result = serde_json::json!({
            "type": "full",
            "status": "completed",
            "download_speed": latest_download,
            "downloadSpeed": latest_download,
            "upload_speed": latest_upload,
            "uploadSpeed": latest_upload,
            "latency": latest_latency,
            "progress": 100.0,
        });

        let _ = app.emit("speed-test-complete", serde_json::json!({
            "testId": test_id,
            "code": 0,
            "result": result,
        }));
    });
}
