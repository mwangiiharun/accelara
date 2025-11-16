# Tauri Migration Guide

## Status: Initial Setup Complete

The basic Tauri structure has been created. This is a significant migration from Electron to Tauri.

## What's Been Done

1. ✅ Tauri project initialized (`src-tauri/`)
2. ✅ Basic Rust structure created:
   - `src/main.rs` - Entry point
   - `src/lib.rs` - Main application setup
   - `src/database.rs` - Database handling (using rusqlite)
   - `src/commands.rs` - Command handlers (stubs)
   - `src/download.rs` - Download management (stub)
3. ✅ Tauri configuration updated
4. ✅ Dependencies added to Cargo.toml

## What Needs to Be Done

### 1. Install Rust (if not installed)
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. Convert All IPC Handlers (24 handlers)

The following Electron IPC handlers need to be fully implemented in Rust:

- [ ] `inspect-torrent` - Torrent file inspection
- [ ] `get-http-info` - HTTP file info
- [ ] `start-download` - Start download (HTTP/torrent)
- [ ] `stop-download` - Stop download
- [ ] `remove-download` - Remove download
- [ ] `pause-download` - Pause download
- [ ] `resume-download` - Resume download
- [ ] `get-active-downloads` - Get active downloads
- [ ] `get-download-history` - Get download history
- [ ] `clear-download-history` - Clear history
- [ ] `get-junk-data-size` - Calculate junk data size
- [ ] `clear-junk-data` - Clear junk data
- [ ] `save-speed-test-result` - Save speed test
- [ ] `get-speed-test-results` - Get speed test results
- [ ] `clear-speed-test-results` - Clear speed tests
- [ ] `start-speed-test` - Start speed test (using iris)
- [ ] `stop-speed-test` - Stop speed test
- [ ] `get-settings` - Get settings
- [ ] `save-settings` - Save settings
- [ ] `select-torrent-file` - File picker
- [ ] `select-download-folder` - Folder picker
- [ ] `open-folder` - Open folder in file manager
- [ ] `get-system-theme` - Get system theme

### 3. Go Binary Integration

Need to:
- Find and execute Go binaries (`api-wrapper`, `iris`)
- Handle process spawning and communication
- Parse JSON output from Go processes
- Manage process lifecycle

### 4. Event System

Convert Electron's `webContents.send()` to Tauri's event system:
- Download updates
- Download completion
- Speed test updates
- System theme changes

### 5. Frontend Updates

Update all frontend code to use Tauri APIs:
- Replace `window.electronAPI` with Tauri `invoke()`
- Replace event listeners with Tauri event listeners
- Update `src/electron.d.ts` to Tauri types

### 6. Build System

- Update `package.json` scripts
- Remove Electron dependencies
- Update DMG creation script for Tauri

## Key Differences: Electron vs Tauri

| Feature | Electron | Tauri |
|---------|-----------|-------|
| Backend | Node.js | Rust |
| IPC | `ipcMain.handle()` | `#[command]` functions |
| Events | `webContents.send()` | `app.emit()` |
| File System | Node.js `fs` | Tauri plugin or Rust `std::fs` |
| Process Spawning | Node.js `child_process` | Rust `std::process` or Tauri plugin |
| Database | sql.js (JavaScript) | rusqlite (Rust) |

## Next Steps

1. Install Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
2. Test basic Tauri app: `npm run tauri dev`
3. Start converting handlers one by one
4. Test each handler as it's converted
5. Update frontend incrementally

## Benefits of Tauri

- ✅ Much smaller bundle size (~5-10MB vs ~100MB+)
- ✅ Better security (no Node.js in renderer)
- ✅ Better performance (Rust backend)
- ✅ No GPU issues (uses system webview)
- ✅ Native feel

