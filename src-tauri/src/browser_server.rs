use axum::{
    extract::{Json, State},
    http::{Method, StatusCode},
    response::Json as ResponseJson,
    routing::post,
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tower::ServiceBuilder;
use tower_http::cors::{CorsLayer, Any};

const BROWSER_SERVER_PORT: u16 = 8765;

#[derive(Debug, Deserialize)]
struct BrowserDownloadRequest {
    #[serde(rename = "type")]
    download_type: String,
    url: Option<String>,
    source: Option<String>,
    filename: Option<String>,
    referrer: Option<String>,
    mime_type: Option<String>,
    #[serde(rename = "mimeType")]
    mime_type_alt: Option<String>,
}

#[derive(Debug, Serialize)]
struct BrowserDownloadResponse {
    success: bool,
    error: Option<String>,
}

/// Start the browser integration HTTP server
pub fn start_browser_server(app: AppHandle) {
    let app_handle = Arc::new(app);
    
    tauri::async_runtime::spawn(async move {
        // Build CORS layer
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::POST, Method::OPTIONS])
            .allow_headers(Any);
        
        // Build router with app handle in state
        let router = Router::new()
            .route("/download", post(handle_download))
            .with_state(app_handle.clone())
            .layer(ServiceBuilder::new().layer(cors));
        
        // Bind to localhost:8765
        let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", BROWSER_SERVER_PORT)).await;
        
        match listener {
            Ok(listener) => {
                eprintln!("[browser-server] Browser integration server listening on http://localhost:{}", BROWSER_SERVER_PORT);
                
                // Run the server
                if let Err(e) = axum::serve(listener, router).await {
                    eprintln!("[browser-server] Server error: {}", e);
                }
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::AddrInUse {
                    eprintln!("[browser-server] Port {} already in use, browser integration may not work", BROWSER_SERVER_PORT);
                } else {
                    eprintln!("[browser-server] Failed to start server: {}", e);
                }
            }
        }
    });
}

async fn handle_download(
    State(app): State<Arc<AppHandle>>,
    Json(payload): Json<BrowserDownloadRequest>,
) -> Result<ResponseJson<BrowserDownloadResponse>, StatusCode> {
    eprintln!("[browser-server] Received browser download request: {:?}", payload);
    
    let source = payload.url
        .or(payload.source)
        .ok_or_else(|| {
            eprintln!("[browser-server] Missing url/source in request");
            StatusCode::BAD_REQUEST
        })?;
    
    // Show and focus the window
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    
    // Determine download type
    let download_type = if source.starts_with("magnet:") || payload.download_type == "magnet" {
        "magnet"
    } else {
        "download"
    };
    
    // Emit event to frontend to open download modal
    let event_data = serde_json::json!({
        "type": download_type,
        "source": source,
        "filename": payload.filename,
        "referrer": payload.referrer,
        "mimeType": payload.mime_type.or(payload.mime_type_alt),
    });
    
    if let Err(e) = app.emit("external-download", event_data) {
        eprintln!("[browser-server] Failed to emit external-download event: {}", e);
        return Ok(ResponseJson(BrowserDownloadResponse {
            success: false,
            error: Some(format!("Failed to process download: {}", e)),
        }));
    }
    
    eprintln!("[browser-server] Successfully processed {} download: {}", download_type, source);
    
    Ok(ResponseJson(BrowserDownloadResponse {
        success: true,
        error: None,
    }))
}

