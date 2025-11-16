use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::path::PathBuf;
use dirs::home_dir;

const GITHUB_REPO: &str = "mwangiiharun/accelara";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReleaseInfo {
    pub tag_name: String,
    pub name: String,
    pub body: String,
    pub published_at: String,
    pub html_url: String,
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
    pub content_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_info: Option<ReleaseInfo>,
    pub error: Option<String>,
}

/// Check for updates by querying GitHub Releases API
pub async fn check_for_updates() -> UpdateCheckResult {
    use crate::logger;
    
    logger::log_info("updater", &format!("Checking for updates. Current version: {}", CURRENT_VERSION));
    
    let client = reqwest::Client::builder()
        .user_agent("ACCELARA-Updater/1.0")
        .timeout(std::time::Duration::from_secs(10))
        .build();
    
    let client = match client {
        Ok(c) => c,
        Err(e) => {
            let error_msg = format!("Failed to create HTTP client: {}", e);
            logger::log_error("updater", &error_msg);
            return UpdateCheckResult {
                has_update: false,
                current_version: CURRENT_VERSION.to_string(),
                latest_version: CURRENT_VERSION.to_string(),
                release_info: None,
                error: Some(error_msg),
            };
        }
    };
    
    let url = format!("https://api.github.com/repos/{}/releases/latest", GITHUB_REPO);
    
    logger::log_info("updater", &format!("Fetching latest release from: {}", url));
    
    match client.get(&url).send().await {
        Ok(response) => {
            if !response.status().is_success() {
                let status = response.status();
                let error_msg = format!("GitHub API returned error: {}", status);
                logger::log_error("updater", &error_msg);
                return UpdateCheckResult {
                    has_update: false,
                    current_version: CURRENT_VERSION.to_string(),
                    latest_version: CURRENT_VERSION.to_string(),
                    release_info: None,
                    error: Some(error_msg),
                };
            }
            
            match response.json::<ReleaseInfo>().await {
                Ok(release) => {
                    let latest_version = release.tag_name.trim_start_matches('v').to_string();
                    let current_version = CURRENT_VERSION.trim_start_matches('v').to_string();
                    
                    logger::log_info("updater", &format!("Latest release: {} (current: {})", latest_version, current_version));
                    
                    // Compare versions (simple string comparison, can be improved with semver)
                    let has_update = compare_versions(&current_version, &latest_version) == Ordering::Less;
                    
                    if has_update {
                        logger::log_info("updater", "Update available!");
                    } else {
                        logger::log_info("updater", "Already on latest version");
                    }
                    
                    UpdateCheckResult {
                        has_update,
                        current_version: CURRENT_VERSION.to_string(),
                        latest_version: release.tag_name.clone(),
                        release_info: Some(release),
                        error: None,
                    }
                }
                Err(e) => {
                    let error_msg = format!("Failed to parse release info: {}", e);
                    logger::log_error("updater", &error_msg);
                    UpdateCheckResult {
                        has_update: false,
                        current_version: CURRENT_VERSION.to_string(),
                        latest_version: CURRENT_VERSION.to_string(),
                        release_info: None,
                        error: Some(error_msg),
                    }
                }
            }
        }
        Err(e) => {
            let error_msg = format!("Failed to fetch release info: {}", e);
            logger::log_error("updater", &error_msg);
            UpdateCheckResult {
                has_update: false,
                current_version: CURRENT_VERSION.to_string(),
                latest_version: CURRENT_VERSION.to_string(),
                release_info: None,
                error: Some(error_msg),
            }
        }
    }
}

/// Simple version comparison (handles semantic versioning)
/// Returns Ordering::Less if v1 < v2, Ordering::Greater if v1 > v2, Ordering::Equal if v1 == v2
fn compare_versions(v1: &str, v2: &str) -> Ordering {
    let v1_parts: Vec<u32> = v1
        .split('.')
        .map(|s| s.parse::<u32>().unwrap_or(0))
        .collect();
    let v2_parts: Vec<u32> = v2
        .split('.')
        .map(|s| s.parse::<u32>().unwrap_or(0))
        .collect();
    
    let max_len = v1_parts.len().max(v2_parts.len());
    
    for i in 0..max_len {
        let v1_part = v1_parts.get(i).copied().unwrap_or(0);
        let v2_part = v2_parts.get(i).copied().unwrap_or(0);
        
        match v1_part.cmp(&v2_part) {
            Ordering::Equal => continue,
            other => return other,
        }
    }
    
    Ordering::Equal
}

/// Download update file to a temporary location
pub async fn download_update(asset_url: &str, filename: &str) -> Result<PathBuf, String> {
    use crate::logger;
    use std::fs::File;
    use std::io::Write;
    
    logger::log_info("updater", &format!("Downloading update from: {}", asset_url));
    
    let client = reqwest::Client::builder()
        .user_agent("ACCELARA-Updater/1.0")
        .timeout(std::time::Duration::from_secs(300)) // 5 minutes for large files
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(asset_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download update: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }
    
    let total_size = response.content_length().unwrap_or(0);
    logger::log_info("updater", &format!("Update file size: {} bytes", total_size));
    
    // Create downloads directory in home folder
    let downloads_dir = if let Some(home) = home_dir() {
        home.join("Downloads")
    } else {
        return Err("Could not determine home directory".to_string());
    };
    
    let file_path = downloads_dir.join(filename);
    
    // Download file
    let mut file = File::create(&file_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    
    use futures_util::StreamExt;
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Download error: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write chunk: {}", e))?;
        downloaded += chunk.len() as u64;
        
        // Log progress every 10MB
        if downloaded % 10_485_760 == 0 {
            let progress = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };
            logger::log_info("updater", &format!("Download progress: {:.1}% ({} / {} bytes)", 
                progress, downloaded, total_size));
        }
    }
    
    logger::log_info("updater", &format!("Update downloaded successfully to: {}", file_path.display()));
    
    Ok(file_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_version_comparison() {
        assert_eq!(compare_versions("3.0.0", "3.0.1"), Ordering::Less);
        assert_eq!(compare_versions("3.0.1", "3.0.0"), Ordering::Greater);
        assert_eq!(compare_versions("3.0.0", "3.0.0"), Ordering::Equal);
        assert_eq!(compare_versions("2.9.9", "3.0.0"), Ordering::Less);
        assert_eq!(compare_versions("3.1.0", "3.0.9"), Ordering::Greater);
    }
}

