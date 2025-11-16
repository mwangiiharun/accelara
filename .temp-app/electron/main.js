const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme, nativeImage, Tray } = require('electron');
const path = require('node:path');
const { spawn, exec } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const http = require('http');
const { getDatabase } = require('./database');

// Disable hardware acceleration to prevent GPU crashes
// This must be called before app is ready
app.disableHardwareAcceleration();

// Additional command-line switches to force disable GPU
// Electron 39.1.1 seems to need these even with disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');

// Minimal startup logging
console.log('Electron starting...');
console.log('Process args:', process.argv);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('isPackaged:', app.isPackaged);
console.log('Hardware acceleration disabled');

// Set app name explicitly
app.setName('ACCELARA');

let mainWindow;
let downloadProcesses = new Map();
let speedTestProcesses = new Map();
let pendingArgs = null;
let tray = null;
let browserServer = null;
const BROWSER_SERVER_PORT = 8765;

// Go log file writer (dev mode only)
let goLogFileStream = null;
let goLogFilePath = null;

// Initialize Go log file in dev mode
function initGoLogFile() {
  // In dev mode, app.isPackaged is false (when running with 'electron .')
  // We don't need to check NODE_ENV - just check if packaged
  const isDev = !app.isPackaged;
  
  console.log(`[Log Init] isDev: ${isDev}, isPackaged: ${app.isPackaged}, NODE_ENV: ${process.env.NODE_ENV}`);
  
  if (isDev) {
    try {
      const logDir = path.join(os.homedir(), '.accelara', 'logs');
      console.log(`[Log Init] Creating log directory: ${logDir}`);
      
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
        console.log(`[Log Init] Log directory created`);
      } else {
        console.log(`[Log Init] Log directory already exists`);
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      goLogFilePath = path.join(logDir, `go-errors-${timestamp}.log`);
      console.log(`[Log Init] Creating log file: ${goLogFilePath}`);
      
      goLogFileStream = fs.createWriteStream(goLogFilePath, { flags: 'a' });
      
      // Write header
      const header = `\n${'='.repeat(80)}\n`;
      const startMsg = `ACCELARA Go Error Log - Started: ${new Date().toISOString()}\n`;
      goLogFileStream.write(header + startMsg + header + '\n');
      
      // Verify file was created
      if (fs.existsSync(goLogFilePath)) {
        console.log(`[Log Init] ✓ Log file verified at: ${goLogFilePath}`);
      } else {
        console.error(`[Log Init] ✗ Log file was not created at: ${goLogFilePath}`);
      }
      
      console.log(`\n📝 Go error log file: ${goLogFilePath}`);
      console.log(`   Tail with: tail -f "${goLogFilePath}"\n`);
      console.log(`   Or use: ./scripts/tail-go-logs.sh\n`);
    } catch (error) {
      console.error('Failed to create Go log file:', error.message);
      console.error('Error stack:', error.stack);
    }
  } else {
    console.log('[Log Init] Not in dev mode, skipping log file creation');
  }
}

// Safe console logging that handles EPIPE errors
function safeConsoleLog(...args) {
  try {
    console.log(...args);
  } catch (error) {
    if (error.code !== 'EPIPE') {
      // Only re-throw if it's not an EPIPE error
      throw error;
    }
  }
}

function safeConsoleError(...args) {
  try {
    console.error(...args);
  } catch (error) {
    if (error.code !== 'EPIPE') {
      // Only re-throw if it's not an EPIPE error
      throw error;
    }
  }
}

function safeConsoleWarn(...args) {
  try {
    console.warn(...args);
  } catch (error) {
    if (error.code !== 'EPIPE') {
      // Only re-throw if it's not an EPIPE error
      throw error;
    }
  }
}

// Write to Go log file (dev mode only)
function writeToGoLog(level, tag, message) {
  if (goLogFileStream) {
    try {
      const timestamp = new Date().toISOString();
      const logLine = `[${timestamp}] [${level}] [${tag}] ${message}\n`;
      goLogFileStream.write(logLine);
      // Note: Node.js WriteStream auto-flushes, but we can force it by writing empty string
      // or just rely on the OS buffer flush (which happens frequently)
    } catch (error) {
      // Don't silently fail - log the error so we know logging is broken
      safeConsoleError('Failed to write to Go log file:', error.message);
      safeConsoleError('Log file path:', goLogFilePath);
    }
  } else {
    // Log file not initialized - this shouldn't happen in dev mode
    safeConsoleWarn(`[Log] Attempted to write log but log file not initialized. isDev check may have failed.`);
  }
}

// Close Go log file on app exit
function closeGoLogFile() {
  if (goLogFileStream) {
    try {
      const footer = `\n${'='.repeat(80)}\n`;
      const endMsg = `ACCELARA Go Error Log - Ended: ${new Date().toISOString()}\n`;
      goLogFileStream.write(footer + endMsg + footer + '\n');
      goLogFileStream.end();
      goLogFileStream = null;
    } catch (error) {
      safeConsoleError('Failed to close Go log file:', error.message);
    }
  }
}

// Handle uncaught exceptions to prevent crashes (after safe console functions are defined)
process.on('uncaughtException', (error) => {
  try {
    safeConsoleError('Uncaught Exception:', error.message);
    safeConsoleError('Stack:', error.stack);
  } catch {
    // If we can't log, at least try to prevent crash
    try {
      console.error('Uncaught Exception (fallback):', error.message);
    } catch {
      // Last resort - ignore
    }
  }
  // Don't exit - let Electron handle it gracefully
});

process.on('unhandledRejection', (reason, promise) => {
  try {
    safeConsoleError('Unhandled Rejection at:', promise);
    safeConsoleError('Reason:', reason);
  } catch {
    try {
      console.error('Unhandled Rejection (fallback):', reason);
    } catch {
      // Ignore
    }
  }
});

// Play completion sound notification
function playCompletionSound() {
  try {
    if (process.platform === 'darwin') {
      // macOS: Use system sound
      exec('afplay /System/Library/Sounds/Glass.aiff', (error) => {
        if (error) {
          // Fallback to beep if Glass.aiff not available
          exec('say "ding"', (fallbackError) => {
            if (fallbackError) {
              // Silently fail if both methods fail
            }
          });
        }
      });
    } else if (process.platform === 'win32') {
      // Windows: Use PowerShell to play beep
      exec('powershell -c "[console]::beep(800,300)"', (error) => {
        if (error) {
          // Silently fail if sound cannot be played
        }
      });
    } else {
      // Linux: Use beep command or speaker-test
      exec('which beep > /dev/null 2>&1 && beep || speaker-test -t sine -f 800 -l 100 > /dev/null 2>&1', (error) => {
        if (error) {
          // Silently fail if sound cannot be played
        }
      });
    }
  } catch (error) {
    // Silently fail if sound cannot be played
    // This is intentional - sound notification is non-critical
    // Log only in development for debugging
    if (process.env.NODE_ENV === 'development') {
      console.debug('Sound notification failed:', error.message);
    }
  }
}

// Helper function to get icon path based on platform
function getIconPath(isDev) {
  if (process.platform === 'darwin') {
    if (isDev) {
      return path.join(__dirname, '../build/icon.icns');
    }
    const iconPath = path.join(process.resourcesPath, 'build/icon.icns');
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
    return path.join(process.resourcesPath, 'app.icns');
  }
  if (process.platform === 'win32') {
    return isDev 
      ? path.join(__dirname, '../build/icon.ico')
      : path.join(process.resourcesPath, 'build/icon.ico');
  }
  return isDev
    ? path.join(__dirname, '../build/icon.png')
    : path.join(process.resourcesPath, 'build/icon.png');
}

// Helper function to get alternative icon paths
function getAlternativeIconPaths() {
  if (process.platform === 'darwin') {
    return [
      path.join(process.cwd(), 'build/icon.icns'),
      path.join(__dirname, '..', 'build', 'icon.icns'),
      path.join(__dirname, '../build/icon.icns'),
    ];
  }
  return [];
}

// Helper function to try loading icon from a path
function tryLoadIconFromPath(tryIconPath, isDev) {
  if (!fs.existsSync(tryIconPath)) {
    return null;
  }
  
  try {
    const absoluteIconPath = path.resolve(tryIconPath);
    const icon = nativeImage.createFromPath(absoluteIconPath);
    if (icon.isEmpty()) {
      if (!isDev) {
        console.warn('Icon image is empty:', absoluteIconPath);
      }
      return null;
    }
    if (isDev) {
      console.log('Window icon set:', absoluteIconPath);
    }
    return icon;
  } catch (error) {
    if (!isDev) {
      console.warn('Failed to load icon from:', tryIconPath, error.message);
    }
    return null;
  }
}

// Helper function to set window icon
function setWindowIcon(windowOptions, isDev) {
  const iconPath = getIconPath(isDev);
  let iconPathsToTry = [iconPath];
  if (!iconPath || !fs.existsSync(iconPath)) {
    iconPathsToTry = getAlternativeIconPaths();
  }
  
  for (const tryIconPath of iconPathsToTry) {
    const icon = tryLoadIconFromPath(tryIconPath, isDev);
    if (icon) {
      windowOptions.icon = icon;
      return;
    }
  }
  
  if (!isDev && iconPathsToTry.length > 0) {
    console.warn('Could not set window icon - tried paths:', iconPathsToTry);
    console.log('Note: In production builds, electron-builder sets the icon automatically');
  }
}

// Helper function to setup window load handlers
function setupWindowLoadHandlers(mainWindow, isDev) {
  if (isDev) {
    const url = 'http://localhost:5173';
    console.log('Loading URL:', url);
    
    mainWindow.loadURL(url).catch(err => {
      try {
        console.error('Error loading URL:', err);
      } catch (logError) {
        if (logError.code !== 'EPIPE') {
          // Only log if it's not an EPIPE error
        }
      }
    });
    
    mainWindow.once('ready-to-show', () => {
      console.log('Window ready to show');
      mainWindow.show();
      mainWindow.focus();
    });
    
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      try {
        console.error('Failed to load:', errorCode, errorDescription);
      } catch (logError) {
        if (logError.code !== 'EPIPE') {
          // Only log if it's not an EPIPE error
        }
      }
      mainWindow.show();
    });
  } else {
    // In production, use app.getAppPath() which returns the ASAR path
    // dist/index.html is at app.asar/dist/index.html
    const appPath = app.getAppPath();
    const filePath = path.join(appPath, 'dist', 'index.html');
    
    console.log('[Production] Loading file from:', filePath);
    console.log('[Production] app.getAppPath():', appPath);
    
    // loadFile should work with asar files - use the full path
    // Electron's loadFile automatically handles asar archives
    console.log('[Production] Attempting to load file from asar...');
    console.log('[Production] Full file path:', filePath);
    
    // Use loadFile - it should handle asar paths automatically
    // app.getAppPath() returns the asar path, so filePath should work
    mainWindow.loadFile(filePath).then(() => {
      console.log('[Production] File loaded successfully');
    }).catch(err => {
      safeConsoleError('[Production] Error loading file:', err.message);
      safeConsoleError('[Production] Error code:', err.code);
      
      // Fallback: try using path relative to app.asar
      const asarPath = path.join(process.resourcesPath, 'app.asar', 'dist', 'index.html');
      console.log('[Production] Trying fallback path:', asarPath);
      console.log('[Production] Fallback path exists?', fs.existsSync(asarPath));
      
      if (fs.existsSync(asarPath)) {
        mainWindow.loadFile(asarPath).then(() => {
          console.log('[Production] File loaded successfully from asar path');
        }).catch(fallbackErr => {
          safeConsoleError('[Production] Fallback also failed:', fallbackErr.message);
          // Show window anyway so user can see there's an issue
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
          }
        });
      } else {
        safeConsoleError('[Production] Fallback path does not exist');
        // Show window anyway
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
        }
      }
    });
    
    // Add error handlers for web contents
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.error('[Production] Failed to load:', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame
      });
      mainWindow.show(); // Show window even if load failed
    });
    
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[Production] Page finished loading');
      // Ensure window is shown after page loads
      if (!mainWindow.isVisible()) {
        console.log('[Production] Window not visible after load, showing');
        mainWindow.show();
      }
    });
    
    // Log console messages from renderer
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[Renderer ${level}]:`, message);
    });
    
    // Log any uncaught exceptions in renderer
    mainWindow.webContents.on('unresponsive', () => {
      console.error('[Production] Renderer process became unresponsive');
    });
    
    mainWindow.webContents.on('crashed', (event, killed) => {
      console.error('[Production] Renderer process crashed, killed:', killed);
    });
    
    mainWindow.once('ready-to-show', () => {
      console.log('[Production] Window ready to show - showing window');
      // Show window first
      mainWindow.show();
      
      // Ensure window is actually visible
      if (!mainWindow.isVisible()) {
        console.log('[Production] Window not visible, forcing show');
        mainWindow.show();
      }
      
      // Bring to front and focus
      if (process.platform === 'darwin') {
        app.dock.show();
        // Use macOS-specific methods to bring window to front
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        mainWindow.setVisibleOnAllWorkspaces(false);
      }
      
      mainWindow.focus();
      mainWindow.moveTop();
      mainWindow.setAlwaysOnTop(true);
      mainWindow.setAlwaysOnTop(false);
      
      console.log('[Production] Window shown, visible:', mainWindow.isVisible(), 'focused:', mainWindow.isFocused());
    });
    
    // Also show on window focus
    mainWindow.on('focus', () => {
      console.log('[Production] Window focused');
    });
    
    mainWindow.on('blur', () => {
      console.log('[Production] Window blurred');
    });
  }
}

function createWindow() {
  // Use app.isPackaged for reliable production detection
  const isDev = !app.isPackaged && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV);
  
  const windowOptions = {
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
    },
    titleBarStyle: 'default',
    backgroundColor: '#0f172a',
    autoHideMenuBar: false,
  };
  
  setWindowIcon(windowOptions, isDev);
  
  mainWindow = new BrowserWindow(windowOptions);
  console.log('Window created');

  setupWindowLoadHandlers(mainWindow, isDev);

  mainWindow.on('close', async (event) => {
    const hasActiveDownloads = downloadProcesses.size > 0;
    
    if (!hasActiveDownloads) {
      mainWindow = null;
      return;
    }
    
    event.preventDefault();
    
    // Always show dialog when there are active downloads
    const db = await getDatabase();
    await handleCloseDialog(db);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Helper function to handle close dialog
async function handleCloseDialog(db) {
  const choice = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Kill on Window Close', 'Run in Background', 'Cancel'],
    defaultId: 1,
    cancelId: 2,
    title: 'Active Downloads',
    message: 'You have active downloads running.',
    detail: 'What would you like to do?\n\n• Kill on Window Close: Stop all downloads and exit\n• Run in Background: Keep downloads running in background (tray/dock icon)\n• Cancel: Return to the application',
  });
  
  if (choice.response === 2) {
    // Cancel - do nothing
    return;
  }
  
  // Save preference
  const newBackgroundMode = choice.response === 1;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'backgroundMode',
    JSON.stringify(newBackgroundMode)
  );
  
  if (choice.response === 0) {
    // Kill on window close - stop all downloads and exit
    await closeCompletely();
  } else {
    // Run in background - keep downloads running
    hideWindowInBackground();
  }
}

// Helper function to hide window in background mode
function hideWindowInBackground() {
  mainWindow.hide();
  
  // Show dock/taskbar icon when in background
  if (process.platform === 'darwin') {
    app.dock.show();
  }
  
  // Create system tray icon if it doesn't exist
  if (!tray) {
    createTrayIcon();
  }
}

// Helper function to create system tray icon
function createTrayIcon() {
  const isDev = !app.isPackaged;
  let iconPath;
  
  if (process.platform === 'darwin') {
    // macOS: Use .icns file
    iconPath = isDev
      ? path.join(__dirname, '../build/icon.icns')
      : path.join(process.resourcesPath, 'build/icon.icns');
  } else if (process.platform === 'win32') {
    // Windows: Use .ico file
    iconPath = isDev
      ? path.join(__dirname, '../build/icon.ico')
      : path.join(process.resourcesPath, 'build/icon.ico');
  } else {
    // Linux: Use .png file
    iconPath = isDev
      ? path.join(__dirname, '../build/icon.png')
      : path.join(process.resourcesPath, 'build/icon.png');
  }
  
  // Fallback to default icon if custom icon not found
  if (!fs.existsSync(iconPath)) {
    iconPath = null; // Use default system icon
  }
  
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : null;
  const image = icon && !icon.isEmpty() ? icon : nativeImage.createEmpty();
  
  tray = new Tray(image);
  
  // Set tooltip
  tray.setToolTip('ACCELARA - Downloads running in background');
  
  // Create context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          if (process.platform === 'darwin') {
            app.dock.show();
          }
          // Destroy tray icon when window is shown
          destroyTrayIcon();
        }
      }
    },
    {
      label: 'Quit',
      click: () => {
        tray.destroy();
        tray = null;
        closeCompletely();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  
  // Double-click to show window (macOS/Linux)
  if (process.platform !== 'win32') {
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        if (process.platform === 'darwin') {
          app.dock.show();
        }
        // Destroy tray icon when window is shown
        destroyTrayIcon();
      }
    });
  }
  
  // Click to show window (Windows)
  if (process.platform === 'win32') {
    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        // Destroy tray icon when window is shown
        destroyTrayIcon();
      }
    });
  }
}

// Helper function to destroy tray icon
function destroyTrayIcon() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

// Helper function to close completely
async function closeCompletely() {
  await gracefulShutdown();
  destroyTrayIcon();
  mainWindow = null;
  app.quit();
}

// Graceful shutdown - pause all active downloads and stop processes
async function gracefulShutdown() {
  // Pause all active downloads in database before stopping processes
  const db = await getDatabase();
  const activeDownloads = db.prepare(`
    SELECT * FROM downloads 
    WHERE status NOT IN ('completed', 'failed', 'cancelled', 'paused')
    ORDER BY started_at DESC
  `).all();
  
  // Mark all active downloads as paused
  for (const download of activeDownloads) {
    try {
      const metadata = download.metadata ? JSON.parse(download.metadata) : {};
      const pausedMetadata = {
        ...metadata,
        pause_reason: 'Paused on app exit',
        paused_at: Date.now(),
        // Preserve current state
        progress: download.progress || 0,
        downloaded: download.downloaded || 0,
        total: download.total || 0,
        speed: download.speed || 0,
        options: metadata.options || {},
      };
      
      db.prepare(`
        UPDATE downloads 
        SET status = ?, metadata = ?, progress = ?, downloaded = ?, total = ?, speed = ?
        WHERE id = ?
      `).run(
        'paused',
        JSON.stringify(pausedMetadata),
        download.progress || 0,
        download.downloaded || 0,
        download.total || 0,
        download.speed || 0,
        download.id
      );
    } catch (error) {
      console.error(`Error pausing download ${download.id} on shutdown:`, error.message);
    }
  }
  
  // Stop all active download processes
  for (const [downloadId, proc] of downloadProcesses.entries()) {
    try {
      proc.kill('SIGTERM');
      // Wait longer for graceful shutdown (especially for torrent clients to release ports)
      await new Promise(resolve => setTimeout(resolve, 2000));
      // Force kill if still running
      if (!proc.killed) {
        proc.kill('SIGKILL');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`Error stopping download ${downloadId}:`, error.message);
    }
  }
  
  downloadProcesses.clear();
}

// Helper function to move completed download to history
async function moveToHistory(downloadId, forceDelete = false) {
  try {
    const database = await getDatabase();
    const download = database.prepare('SELECT * FROM downloads WHERE id = ?').get(downloadId);
    if (download) {
      // Check if it's a seeding torrent - if so, don't delete from downloads
      const isSeeding = download.status === 'seeding' || 
                       (download.type === 'torrent' && download.status === 'completed');
      
      // Get actual file size if available
      let fileSize = download.total || download.downloaded || 0;
      try {
        // Try to get actual file size from filesystem
        if (download.output && fs.existsSync(download.output)) {
          const stats = fs.statSync(download.output);
          if (stats.isFile()) {
            fileSize = stats.size;
          } else if (stats.isDirectory()) {
            // For directories (torrents), calculate total size
            let totalSize = 0;
            const calculateDirSize = (dir) => {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  calculateDirSize(fullPath);
                } else {
                  try {
                    totalSize += fs.statSync(fullPath).size;
                  } catch {
                    // Ignore errors
                  }
                }
              }
            };
            calculateDirSize(download.output);
            fileSize = totalSize || download.total || download.downloaded || 0;
          }
        }
      } catch {
        // If file doesn't exist or can't be accessed, use database values
        fileSize = download.total || download.downloaded || 0;
      }
      
      // Add to history
      const insertHistory = database.prepare(`
        INSERT OR REPLACE INTO download_history (id, source, output, type, size, completed_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertHistory.run(
        downloadId,
        download.source,
        download.output,
        download.type,
        fileSize,
        Date.now(),
        download.metadata || ''
      );
      
      // Only delete from downloads if not seeding (or if forceDelete is true)
      if (forceDelete || !isSeeding) {
        database.prepare('DELETE FROM downloads WHERE id = ?').run(downloadId);
      } else {
        // Update status to seeding if not already
        if (download.status !== 'seeding') {
          database.prepare('UPDATE downloads SET status = ? WHERE id = ?').run('seeding', downloadId);
        }
      }
    }
  } catch (error) {
    try {
      console.error('Error moving download to history:', error.message);
    } catch (logError) {
      // Ignore EPIPE errors from console - this is intentional
      if (logError.code !== 'EPIPE') {
        // Only log if it's not an EPIPE error
      }
    }
  }
}

// Helper function to setup process handlers for a restarted download
function setupRestartedDownloadHandlers(proc, downloadId, metadata, download) {
  let isProcessActive = true;
  
  // Buffer for incomplete JSON lines (for restarted downloads)
  let restartedStdoutBuffer = '';
  
  proc.stdout.on('data', async (data) => {
    if (!isProcessActive) return;
    
    try {
      // Add new data to buffer
      restartedStdoutBuffer += data.toString();
      
      // Try to extract complete JSON objects from buffer
      const lines = restartedStdoutBuffer.split('\n');
      // Keep the last line in buffer (might be incomplete)
      restartedStdoutBuffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // Try to find and parse JSON objects (same logic as main download handler)
        let remaining = trimmed;
        while (remaining.length > 0) {
          const jsonStart = remaining.indexOf('{');
          if (jsonStart === -1) break;
          
          // Find matching closing brace
          let jsonEnd = -1;
          let braceCount = 0;
          let inString = false;
          let escapeNext = false;
          
          for (let i = jsonStart; i < remaining.length; i++) {
            const char = remaining[i];
            if (escapeNext) {
              escapeNext = false;
              continue;
            }
            if (char === '\\') {
              escapeNext = true;
              continue;
            }
            if (char === '"') {
              inString = !inString;
              continue;
            }
            if (!inString) {
              if (char === '{') braceCount++;
              else if (char === '}') {
                braceCount--;
                if (braceCount === 0) {
                  jsonEnd = i + 1;
                  break;
                }
              }
            }
          }
          
          if (jsonEnd > jsonStart) {
            try {
              const jsonStr = remaining.substring(jsonStart, jsonEnd);
              const status = JSON.parse(jsonStr);
              await processStatusUpdate(status, downloadId);
              remaining = remaining.substring(jsonEnd).trim();
            } catch (parseError) {
              restartedStdoutBuffer = remaining + '\n' + restartedStdoutBuffer;
              console.debug('Failed to parse status update:', parseError.message);
              break;
            }
          } else {
            restartedStdoutBuffer = remaining + '\n' + restartedStdoutBuffer;
            break;
          }
        }
      }
    } catch (error) {
      if (isProcessActive) {
        try {
          console.debug('Failed to parse status update:', error.message);
        } catch (logError) {
          if (logError.code !== 'EPIPE') {
            // Only log if it's not an EPIPE error
          }
        }
      }
    }
  });
  
    proc.stderr.on('data', (data) => {
      if (!isProcessActive) return;
      try {
        const lines = data.toString().split('\n').filter(line => line.trim());
        for (const errorMsg of lines) {
          if (errorMsg) {
            safeConsoleError(`═══════════════════════════════════════════════════════════`);
            safeConsoleError(`[${downloadId}] Go Error (Restarted Download):`);
            safeConsoleError(`  ${errorMsg}`);
            safeConsoleError(`═══════════════════════════════════════════════════════════`);
            writeToGoLog('ERROR', downloadId, `(restarted) ${errorMsg}`);
          }
        }
      } catch (error) {
        if (error.code !== 'EPIPE') {
          safeConsoleError(`[${downloadId}] Error processing stderr:`, error.message);
          writeToGoLog('ERROR', downloadId, `Error processing stderr: ${error.message}`);
        }
      }
    });
  
  proc.on('error', (error) => {
    isProcessActive = false;
    try {
      safeConsoleError(`Failed to restart Go process: ${error.message}`);
    } catch (logError) {
      if (logError.code !== 'EPIPE') {
        // Only log if it's not an EPIPE error
      }
    }
  });
  
  proc.on('close', async (code) => {
    isProcessActive = false;
    downloadProcesses.delete(downloadId);
    
    proc.stdout.removeAllListeners('data');
    proc.stderr.removeAllListeners('data');
    
    // Check if download was paused - don't complete if paused
    const db = await getDatabase();
    const downloadStatus = db.prepare('SELECT status FROM downloads WHERE id = ?').get(downloadId);
    
    if (code === 0 && downloadStatus && downloadStatus.status !== 'paused') {
      // Check if this is a seeding torrent
      const isSeedingTorrent = downloadStatus.type === 'torrent' && 
                               (downloadStatus.status === 'seeding' || downloadStatus.status === 'completed');
      
      playCompletionSound();
      // For seeding torrents, add to history but keep in downloads
      await moveToHistory(downloadId, !isSeedingTorrent);
      notifyDownloadComplete(downloadId, code, download.output);
    } else if (downloadStatus && downloadStatus.status === 'paused') {
      // Download was paused - don't complete, just notify
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-update', {
          downloadId,
          download_id: downloadId,
          status: 'paused',
        });
      }
    } else {
      // Error or other non-zero exit
      notifyDownloadComplete(downloadId, code, download.output);
    }
  });
  
  // Send initial state to renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    // For torrents, if progress is 100% or status is seeding, ensure status is 'seeding'
    let initialStatus = download.status || 'downloading';
    if (download.type === 'torrent' && (download.progress >= 1.0 || download.progress === 1 || download.status === 'seeding')) {
      initialStatus = 'seeding';
    }
    
    mainWindow.webContents.send('download-update', {
      downloadId: download.id,
      download_id: download.id,
      ...metadata,
      status: initialStatus,
      progress: download.progress || 0,
      downloaded: download.downloaded || 0,
      total: download.total || 0,
      speed: download.speed || 0,
    });
  }
}

// Reattach to existing downloads from database
async function reattachToDownloads() {
  try {
    const db = await getDatabase();
    // Get active downloads, including failed HTTP downloads and error-status downloads (they can be resumed or viewed)
    const activeDownloads = db.prepare(`
      SELECT * FROM downloads 
      WHERE status NOT IN ('completed', 'cancelled')
      AND (status != 'failed' OR type = 'http' OR status = 'error')
      ORDER BY started_at DESC
    `).all();
    
    if (activeDownloads.length === 0) {
      return;
    }
    
    
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      for (const download of activeDownloads) {
        try {
          const metadata = download.metadata ? JSON.parse(download.metadata) : {};
          const options = metadata.options || {};
          
          // Mark all downloads as paused on app restart (except completed/cancelled)
          // Clear errors on restart - they should be cleared if resolved
          if (download.status !== 'paused' && download.status !== 'completed' && download.status !== 'cancelled') {
            const pausedMetadata = {
              ...metadata,
              pause_reason: 'Paused on app exit',
              paused_at: Date.now(),
              options: metadata.options || {},
              // Clear error-related fields on restart
              error: null,
              last_error: null,
              error_time: null,
            };
            
            db.prepare(`
              UPDATE downloads 
              SET status = ?, metadata = ?, error = NULL
              WHERE id = ?
            `).run('paused', JSON.stringify(pausedMetadata), download.id);
            
            download.status = 'paused';
            download.error = null;
            metadata = pausedMetadata;
          } else if (download.status === 'paused') {
            // Even if already paused, clear errors on restart
            const clearedMetadata = {
              ...metadata,
              error: null,
              last_error: null,
              error_time: null,
            };
            
            db.prepare(`
              UPDATE downloads 
              SET metadata = ?, error = NULL
              WHERE id = ?
            `).run(JSON.stringify(clearedMetadata), download.id);
            
            metadata = clearedMetadata;
            download.error = null;
          }
          
          // Send download state to UI (errors cleared on restart)
          if (mainWindow && !mainWindow.isDestroyed()) {
            // Send complete download state to UI
            mainWindow.webContents.send('download-update', {
              downloadId: download.id,
              download_id: download.id,
              source: download.source,
              output: download.output,
              type: download.type,
              status: download.status, // Should be 'paused' for all non-completed downloads
              progress: download.progress || 0,
              downloaded: download.downloaded || 0,
              total: download.total || 0,
              speed: download.speed || 0,
              error: null, // Clear errors on restart
              message: null, // Clear messages on restart
              messages: [], // Clear messages array on restart
              pause_reason: metadata.pause_reason || (download.status === 'paused' ? 'Paused on app exit' : undefined),
              // Include all metadata fields for complete state restoration
              ...metadata,
              // Preserve torrent-specific fields if present
              torrent_name: metadata.torrent_name,
              file_progress: metadata.file_progress,
              peers: metadata.peers,
              seeds: metadata.seeds,
              // Preserve HTTP-specific fields if present
              chunk_progress: metadata.chunk_progress,
              speedHistory: metadata.speedHistory || [],
            });
          }
          
          // Don't restart downloads - they should remain paused until user manually resumes
          // User must click resume button to continue downloads
        } catch (error) {
          console.error(`Error restarting download ${download.id}:`, error.message);
        }
      }
    });
  } catch (error) {
    console.error('Error reattaching to downloads:', error.message);
  }
}

// Handle protocol and file arguments
const gotTheLock = app.requestSingleInstanceLock();
console.log('[App Init] Single instance lock:', gotTheLock);

if (gotTheLock) {
  console.log('[App Init] Got lock, setting up app...');
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    
    // Handle command line arguments (Windows file associations come through here)
    console.log('Second instance detected with args:', commandLine);
    // Skip the first arg (executable path) and process the rest
    const args = commandLine.slice(1);
    if (args.length > 0) {
      handleArgs(args);
    }
  });

  // macOS: Handle magnet links via protocol handler
  app.on('open-url', (event, url) => {
    event.preventDefault();
    console.log('open-url event received:', url);
    if (mainWindow) {
      handleMagnetLink(url);
    } else {
      pendingArgs = { type: 'magnet', url };
    }
  });

  // macOS: Handle .torrent file associations
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    console.log('open-file event received:', filePath);
    if (mainWindow) {
      handleTorrentFile(filePath);
    } else {
      pendingArgs = { type: 'torrent', path: filePath };
    }
  });

// Helper function to try setting dock icon from a path
function trySetDockIconFromPath(tryIconPath, isDev) {
  const icon = tryLoadIconFromPath(tryIconPath, isDev);
  if (!icon) {
    return false;
  }
  
  try {
    app.dock.setIcon(icon);
    const absoluteIconPath = path.resolve(tryIconPath);
    console.log('Dock icon set:', absoluteIconPath);
    return true;
  } catch (dockError) {
    if (!isDev) {
      console.warn('Could not set dock icon (non-fatal):', dockError.message);
    }
    return false;
  }
}

// Helper function to set dock icon
function setDockIcon(isDev) {
  if (process.platform !== 'darwin') {
    return;
  }
  
  const iconPath = getIconPath(isDev);
  let iconPathsToTry = [iconPath];
  if (!iconPath || !fs.existsSync(iconPath)) {
    iconPathsToTry = getAlternativeIconPaths();
  }
  
  for (const tryIconPath of iconPathsToTry) {
    if (trySetDockIconFromPath(tryIconPath, isDev)) {
      return;
    }
  }
  
  if (!isDev && iconPathsToTry.length > 0) {
    console.warn('Could not set dock icon - tried paths:', iconPathsToTry);
    console.log('Note: In production builds, electron-builder sets the icon automatically');
  }
}

  // eslint-disable-next-line unicorn/prefer-top-level-await
  app.whenReady().then(() => {
    console.log('[App Ready] Promise resolved!');
    // In dev mode, app.isPackaged is false (when running with 'electron .')
    const isDev = !app.isPackaged;
    
    console.log('[App Ready] Initializing...');
    console.log('[App Ready] isPackaged:', app.isPackaged);
    console.log('[App Ready] NODE_ENV:', process.env.NODE_ENV);
    console.log('[App Ready] isDev:', isDev);
    
    // Initialize Go log file in dev mode
    initGoLogFile();
    
    setDockIcon(isDev);
    
    createWindow();
    
    // Start browser integration server
    startBrowserServer();

    // Reattach to existing downloads from database (wait for window to be ready)
    setTimeout(() => {
      reattachToDownloads().catch((error) => {
        console.error('Error reattaching to downloads:', error.message);
      });
    }, 1000);

    // Handle initial arguments (Windows file associations come through argv)
    // On Windows, file associations pass the file path as an argument
    // On macOS, they use the 'open-file' event (handled above)
    const args = process.argv.slice(1);
    if (args.length > 0) {
      console.log('Processing initial arguments:', args);
      handleArgs(args);
    }

    // Handle pending args from protocol/file handlers
    if (pendingArgs) {
      if (pendingArgs.type === 'magnet') {
        handleMagnetLink(pendingArgs.url);
      } else if (pendingArgs.type === 'torrent') {
        handleTorrentFile(pendingArgs.path);
      }
      pendingArgs = null;
    }

    app.on('activate', () => {
      // On macOS, re-show window when dock icon is clicked
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        if (process.platform === 'darwin') {
          app.dock.show();
        }
        // Destroy tray icon when window is shown
        destroyTrayIcon();
      } else if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  }).catch((error) => {
    console.error('[App Ready] Error in whenReady promise:', error);
    console.error('[App Ready] Error stack:', error.stack);
  });
} else {
  console.log('[App Init] Another instance is running, quitting...');
  app.quit();
}

function handleArgs(args) {
  for (const arg of args) {
    if (!arg) continue;
    
    // Skip Electron internal arguments
    if (arg.startsWith('--') || arg === '.' || arg === './') {
      continue;
    }
    
    // Handle magnet links
    if (arg.startsWith('magnet:')) {
      console.log('Handling magnet link from args:', arg);
      handleMagnetLink(arg);
    } 
    // Handle .torrent files (Windows passes full path, macOS/Linux might pass relative)
    else if (arg.toLowerCase().endsWith('.torrent')) {
      // Resolve to absolute path if relative
      const absolutePath = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
      handleTorrentFile(absolutePath);
    }
  }
}

function handleMagnetLink(magnetLink) {
  // Ensure window is visible and focused
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    
    if (mainWindow.webContents) {
      mainWindow.webContents.send('external-download', {
        type: 'magnet',
        source: magnetLink,
      });
    }
  }
}

function handleTorrentFile(filePath) {
  const absolutePath = path.isAbsolute(filePath) 
    ? filePath 
    : path.resolve(process.cwd(), filePath);
  
  // Ensure window is visible and focused
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    
    if (mainWindow.webContents) {
      mainWindow.webContents.send('external-download', {
        type: 'torrent',
        source: absolutePath,
      });
    }
  }
}

// Pause all downloads before app quits (enforced behavior)
app.on('before-quit', async (event) => {
  // Pause all active downloads before quitting
  await gracefulShutdown();
  
  // Close Go log file
  closeGoLogFile();
});

app.on('window-all-closed', () => {
  // Check if we should keep running in background
  getDatabase().then((db) => {
    const bgModeSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('backgroundMode');
    const backgroundMode = bgModeSetting ? JSON.parse(bgModeSetting.value) : false;
    const hasActiveDownloads = downloadProcesses.size > 0;
    
    // Keep app running if background mode is enabled and there are active downloads
    if (backgroundMode && hasActiveDownloads) {
      // Don't quit - keep running in background
      // Show dock/taskbar icon and create tray icon
      if (process.platform === 'darwin') {
        app.dock.show();
      }
      if (!tray) {
        createTrayIcon();
      }
      return;
    }
    // Stop browser server on quit
    if (browserServer) {
      browserServer.close(() => {
        console.log('Browser integration server stopped');
      });
      browserServer = null;
    }
    
    // Normal quit behavior (downloads already paused by before-quit handler)
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
});

// Set as default protocol handler for magnet links
// This registers the app to handle magnet: protocol on macOS, Windows, and Linux
// Note: In production, electron-builder automatically registers protocol handlers
// This is mainly for development mode
if (process.defaultApp) {
  // Development mode
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('magnet', process.execPath, [path.resolve(process.argv[1])]);
    console.log('Registered as default handler for magnet: protocol (dev mode)');
  }
} else {
  // Production mode - electron-builder handles registration, but we ensure it's set
  const success = app.setAsDefaultProtocolClient('magnet');
  if (success) {
    console.log('Registered as default handler for magnet: protocol');
  } else {
    console.log('Note: Protocol handler registration handled by electron-builder');
  }
}

// Note: File associations for .torrent files are handled by electron-builder
// They are registered in electron-builder.yml and work automatically on install
// On macOS: Uses Info.plist CFBundleDocumentTypes
// On Windows: Uses NSIS installer registry entries

// IPC Handlers
ipcMain.handle('inspect-torrent', async (event, source) => {
  const { spawn } = require('node:child_process');
  
  const foundBinary = findGoBinary();
  const goBinary = verifyAndNormalizeBinary(foundBinary);

  return new Promise((resolve, reject) => {
    // For cwd, we need a real directory, not inside ASAR
    // In packaged apps, use the user's home directory or a temp directory
    let workingDir;
    if (app.isPackaged) {
      // In packaged app, use home directory or temp directory
      workingDir = os.homedir();
    } else {
      // In dev, use project root
      workingDir = path.join(__dirname, '..');
    }
    const proc = spawn(goBinary, ['--inspect', '--source', source], {
      cwd: workingDir,
      env: { ...process.env }
    });
    
    proc.on('error', (error) => {
      safeConsoleError('=== spawn error ===');
      safeConsoleError('Error code:', error.code);
      safeConsoleError('Error message:', error.message);
      safeConsoleError('Binary path used:', goBinary);
      safeConsoleError('Path exists?', fs.existsSync(goBinary));
      if (fs.existsSync(goBinary)) {
        const stats = fs.statSync(goBinary);
        safeConsoleError('Path stats:', {
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          mode: stats.mode.toString(8),
          size: stats.size
        });
      }
      reject(error);
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      const errorMsg = data.toString().trim();
      if (errorMsg) {
        safeConsoleError(`═══════════════════════════════════════════════════════════`);
        safeConsoleError(`[inspect-torrent] Go Error:`);
        safeConsoleError(`  ${errorMsg}`);
        safeConsoleError(`═══════════════════════════════════════════════════════════`);
        writeToGoLog('ERROR', 'inspect-torrent', errorMsg);
      }
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (err) {
          reject(new Error('Failed to parse torrent info: ' + err.message));
        }
      } else {
        reject(new Error(stderr || 'Failed to inspect torrent'));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
});

ipcMain.handle('get-http-info', async (event, source) => {
  const { spawn } = require('node:child_process');
  const goBinary = verifyAndNormalizeBinary(findGoBinary());

  return new Promise((resolve, reject) => {
    // For cwd, we need a real directory, not inside ASAR
    let workingDir;
    if (app.isPackaged) {
      workingDir = os.homedir();
    } else {
      workingDir = path.join(__dirname, '..');
    }
    
    const proc = spawn(goBinary, ['--http-info', '--source', source], {
      cwd: workingDir,
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (err) {
          reject(new Error('Failed to parse HTTP info: ' + err.message));
        }
      } else {
        reject(new Error(stderr || 'Failed to get HTTP info'));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
});

// Helper function to resolve output path
async function resolveOutputPath(output) {
  if (output) {
    return output;
  }
  const db = await getDatabase();
  const defaultPath = db.prepare('SELECT value FROM settings WHERE key = ?').get('defaultDownloadPath');
  return defaultPath ? JSON.parse(defaultPath.value) : path.join(os.homedir(), 'Downloads');
}

// Helper function to build command line arguments
function buildCommandArgs(source, outputPath, downloadId, options) {
  return [
    '--source', source,
    '--output', outputPath,
    '--download-id', downloadId,
    ...Object.entries(options || {}).flatMap(([key, value]) => {
      if (value === undefined || value === null) return [];
      const flag = key.replaceAll('_', '-');
      if (typeof value === 'boolean' && value) {
        return [`--${flag}`];
      }
      return [`--${flag}`, value.toString()];
    })
  ];
}

// Helper function to find Go binary
function findGoBinary() {
  const exeExtension = process.platform === 'win32' ? '.exe' : '';
  const binaryName = `api-wrapper${exeExtension}`;
  
  // Build comprehensive list of possible paths
  const possiblePaths = [];
  
  // Development paths
  possiblePaths.push(path.resolve(__dirname, '../bin', binaryName));
  
  // Production paths - try multiple variations
  // In Electron, process.resourcesPath can point to either:
  // 1. Resources directory: /path/to/ACCELARA.app/Contents/Resources
  // 2. app.asar: /path/to/ACCELARA.app/Contents/Resources/app.asar
  if (process.resourcesPath) {
    // Check if resourcesPath points to app.asar (common in packaged apps)
    if (process.resourcesPath.includes('app.asar')) {
      // If it points to app.asar, go up to the actual Resources directory
      const resourcesDir = path.dirname(process.resourcesPath);
      possiblePaths.push(path.join(resourcesDir, 'bin', binaryName));
    } else {
      // Standard production path (resourcesPath is the Resources directory)
      possiblePaths.push(path.join(process.resourcesPath, 'bin', binaryName));
    }
  }
  
  // Platform-specific path detection using app.getPath('exe') (most reliable method)
  // This works even when process.resourcesPath might be incorrect
  if (app && typeof app.getPath === 'function') {
    try {
      const exePath = app.getPath('exe');
      
      if (process.platform === 'darwin') {
        // macOS: exePath is /path/to/ACCELARA.app/Contents/MacOS/ACCELARA
        // Go up to Contents, then into Resources
        const contentsDir = path.dirname(path.dirname(exePath));
        const resourcesDir = path.join(contentsDir, 'Resources');
        const binPath = path.join(resourcesDir, 'bin', binaryName);
        possiblePaths.unshift(binPath); // Add to front of list (highest priority)
      } else if (process.platform === 'linux') {
        // Linux: exePath might be in AppImage or regular installation
        // For AppImage: exePath is the AppImage itself or a symlink
        // For regular install: exePath is in the app directory
        const exeDir = path.dirname(exePath);
        
        // Check if we're in an AppImage (AppImages are mounted at /tmp/.mount_*)
        if (exePath.includes('.AppImage') || exeDir.includes('.AppImage') || exeDir.includes('/.mount_')) {
          // AppImage structure: binary is in resources/bin relative to AppImage mount
          // The resources are typically in the same directory as the executable
          const resourcesDir = exeDir;
          const binPath = path.join(resourcesDir, 'bin', binaryName);
          possiblePaths.unshift(binPath);
          
          // Also try resources subdirectory (common AppImage structure)
          const resourcesSubDir = path.join(exeDir, 'resources');
          possiblePaths.unshift(path.join(resourcesSubDir, 'bin', binaryName));
        } else {
          // Regular Linux installation: try resources directory
          const resourcesDir = path.join(exeDir, 'resources');
          possiblePaths.unshift(path.join(resourcesDir, 'bin', binaryName));
          
          // Also try parent directory (if exe is in a subdirectory)
          const parentDir = path.dirname(exeDir);
          possiblePaths.unshift(path.join(parentDir, 'resources', 'bin', binaryName));
        }
      }
      // Windows: process.resourcesPath should handle it (checked above)
    } catch (err) {
      if (app.isPackaged) {
        console.warn('Failed to get exe path:', err.message);
      }
    }
  }
  
  // Fallback: try to derive from process.execPath (always available, works on all platforms)
  try {
    const execPath = process.execPath;
    
    if (process.platform === 'darwin') {
      // macOS: execPath might be: /path/to/ACCELARA.app/Contents/MacOS/ACCELARA
      if (execPath.includes('.app/Contents/MacOS/')) {
        const contentsDir = path.dirname(path.dirname(execPath));
        const resourcesDir = path.join(contentsDir, 'Resources');
        const binPath = path.join(resourcesDir, 'bin', binaryName);
        if (!possiblePaths.includes(binPath)) {
          possiblePaths.unshift(binPath);
        }
      }
    } else if (process.platform === 'linux') {
      // Linux: execPath might be AppImage or regular executable
      const execDir = path.dirname(execPath);
      
      if (execPath.includes('.AppImage') || execDir.includes('/.mount_')) {
        // AppImage: resources are typically in the same directory
        const binPath = path.join(execDir, 'bin', binaryName);
        if (!possiblePaths.includes(binPath)) {
          possiblePaths.unshift(binPath);
        }
        // Also try resources subdirectory (common AppImage structure)
        const resourcesBinPath = path.join(execDir, 'resources', 'bin', binaryName);
        if (!possiblePaths.includes(resourcesBinPath)) {
          possiblePaths.unshift(resourcesBinPath);
        }
      } else {
        // Regular Linux: try resources directory
        const resourcesBinPath = path.join(execDir, 'resources', 'bin', binaryName);
        if (!possiblePaths.includes(resourcesBinPath)) {
          possiblePaths.unshift(resourcesBinPath);
        }
      }
    }
    // Windows: process.resourcesPath should handle it
  } catch (err) {
    // Ignore errors
  }
  
  // Also try app.getAppPath() for ASAR location
  if (app && typeof app.getAppPath === 'function') {
    try {
      const appPath = app.getAppPath();
      if (appPath.includes('.asar')) {
        // appPath is something like /path/to/ACCELARA.app/Contents/Resources/app.asar
        // We need to go up to Resources directory (dirname of app.asar)
        const resourcesDir = path.dirname(appPath); // This gives us Resources directory
        possiblePaths.push(path.join(resourcesDir, 'bin', binaryName));
        console.log('Using app.getAppPath() to find Resources:', resourcesDir);
      }
    } catch {
      // Ignore errors
    }
  }
  
  // Current working directory (fallback)
  possiblePaths.push(path.join(process.cwd(), 'bin', binaryName));
  
  // Remove duplicates and nulls
  const uniquePaths = [...new Set(possiblePaths.filter(Boolean))];
  
  // Check each path in order
  for (const possiblePath of uniquePaths) {
    try {
      if (fs.existsSync(possiblePath)) {
        // Verify it's executable (on Unix-like systems)
        if (process.platform !== 'win32') {
          try {
            fs.accessSync(possiblePath, fs.constants.X_OK);
          } catch {
            // Not executable, try next path
            continue;
          }
        }
        
        // Verify it's actually a file (not a directory)
        const stats = fs.statSync(possiblePath);
        if (stats.isDirectory()) {
          // If it's a directory, try to find the binary inside it
          const binaryInDir = path.join(possiblePath, binaryName);
          if (fs.existsSync(binaryInDir) && fs.statSync(binaryInDir).isFile()) {
            return binaryInDir;
          }
          continue;
        }
        if (!stats.isFile()) {
          continue;
        }
        
        // Return the absolute resolved path, ensuring it's a file path (not directory)
        const resolvedPath = path.resolve(possiblePath);
        // Double-check it's still a file after resolution
        const resolvedStats = fs.statSync(resolvedPath);
        if (!resolvedStats.isFile()) {
          continue; // Try next path
        }
        return resolvedPath;
      }
    } catch (err) {
      // Continue to next path if this one fails
    }
  }
  
  // None found - provide detailed error information
  const errorDetails = [];
  errorDetails.push('Go binary not found!');
  errorDetails.push(`Binary name: ${binaryName}`);
  errorDetails.push(`Platform: ${process.platform}`);
  errorDetails.push(`Resources path: ${process.resourcesPath || 'undefined'}`);
  errorDetails.push(`__dirname: ${__dirname}`);
  if (app && typeof app.getPath === 'function') {
    try {
      errorDetails.push(`App exe: ${app.getPath('exe')}`);
      errorDetails.push(`App path: ${app.getAppPath()}`);
    } catch {}
  }
  errorDetails.push('\nTried paths:');
  uniquePaths.forEach((p, i) => {
    const exists = fs.existsSync(p);
    errorDetails.push(`  ${i + 1}. ${p} ${exists ? '(exists)' : '(not found)'}`);
    if (exists) {
      try {
        const stats = fs.statSync(p);
        errorDetails.push(`     Type: ${stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : 'other'}`);
        if (process.platform !== 'win32') {
          try {
            fs.accessSync(p, fs.constants.X_OK);
            errorDetails.push(`     Executable: yes`);
          } catch {
            errorDetails.push(`     Executable: no`);
          }
        }
      } catch {}
    }
  });
  
  const errorMsg = errorDetails.join('\n');
  try {
    console.error(errorMsg);
  } catch (logError) {
    // Ignore EPIPE errors from console
    if (logError.code !== 'EPIPE') {
      // Only log if it's not an EPIPE error
    }
  }
  throw new Error(`Go binary not found. Please ensure the binary is built and included in the app bundle.`);
}

/**
 * Verifies and normalizes the Go binary path before spawning.
 * Throws an error if the path is invalid, doesn't exist, or is not a file.
 */
function verifyAndNormalizeBinary(binaryPath) {
  if (!binaryPath) {
    throw new Error('Binary path is empty or undefined');
  }
  
  // Normalize the path (resolve relative paths, remove trailing slashes, etc.)
  // Use path.normalize first to clean up the path, then resolve
  let normalizedPath = path.normalize(binaryPath);
  
  // If it's not absolute, resolve it relative to the current working directory
  if (!path.isAbsolute(normalizedPath)) {
    normalizedPath = path.resolve(process.cwd(), normalizedPath);
  } else {
    normalizedPath = path.resolve(normalizedPath);
  }
  
  // Verify it exists first
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`Binary not found at: ${normalizedPath}`);
  }
  
  // Resolve any symlinks to get the actual file path
  // This is important on macOS where paths might be symlinked
  try {
    normalizedPath = fs.realpathSync(normalizedPath);
  } catch (err) {
    // If realpathSync fails, use the original path
    // Silently continue
  }
  
  // Verify it's a file, not a directory
  const stats = fs.statSync(normalizedPath);
  
  if (stats.isDirectory()) {
    throw new Error(`Binary path is a directory, not a file: ${normalizedPath}`);
  }
  
  if (!stats.isFile()) {
    throw new Error(`Binary path is not a file (is directory?): ${normalizedPath}`);
  }
  
  // Verify it's executable on Unix-like systems
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(normalizedPath, fs.constants.X_OK);
    } catch (err) {
      throw new Error(`Binary is not executable: ${normalizedPath}`);
    }
  }
  
  return normalizedPath;
}

// Helper function to determine download type
function determineDownloadType(source) {
  if (source.startsWith('magnet:') || source.endsWith('.torrent')) {
    return 'torrent';
  }
  return 'http';
}

// Helper function to notify download completion
function notifyDownloadComplete(downloadId, code, outputPath) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('download-complete', { 
        downloadId,
        download_id: downloadId, // Support both formats
        code,
        output: outputPath,
        success: code === 0
      });
    } catch (error) {
      // Ignore errors if window is destroyed - this is intentional
      if (error.code && error.code !== 'EPIPE') {
        // Only log if it's not an expected error
      }
    }
  }
}

// Helper function to store torrent state
function storeTorrentState(database, status, downloadId) {
  if (status.type === 'torrent' && status.info_hash && status.piece_count && status.piece_states) {
    try {
      const pieceStatesJson = JSON.stringify(status.piece_states);
      const updateTorrentState = database.prepare(`
        INSERT OR REPLACE INTO torrent_state (download_id, info_hash, piece_count, piece_states, verified_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      updateTorrentState.run(
        downloadId,
        status.info_hash,
        status.piece_count,
        pieceStatesJson,
        Date.now()
      );
    } catch (error) {
      // Ignore errors in state storage
      console.debug('Failed to store torrent state:', error.message);
    }
  }
}

// Helper function to store HTTP state
function storeHttpState(database, status, downloadId) {
  if (status.type === 'http' && status.chunk_progress && status.chunk_count) {
    try {
      const chunkProgressJson = JSON.stringify(status.chunk_progress);
      const download = database.prepare('SELECT source, output FROM downloads WHERE id = ?').get(downloadId);
      if (download) {
        const updateHttpState = database.prepare(`
          INSERT OR REPLACE INTO http_state (download_id, source_url, file_path, total_size, chunk_count, chunk_progress, sha256, verified_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        updateHttpState.run(
          downloadId,
          download.source,
          download.output,
          status.total || 0,
          status.chunk_count || 0,
          chunkProgressJson,
          status.sha256 || null,
          Date.now()
        );
      }
    } catch (error) {
      // Ignore errors in state storage
      console.debug('Failed to store HTTP state:', error.message);
    }
  }
}

// Helper function to process status update
async function processStatusUpdate(status, downloadId) {
  const updateData = { 
    downloadId, 
    download_id: downloadId,
    ...status 
  };
  
  const database = await getDatabase();
  
  // Check current status in database - if paused, don't allow status updates to change it
  const currentDownload = database.prepare('SELECT status, metadata FROM downloads WHERE id = ?').get(downloadId);
  if (currentDownload && currentDownload.status === 'paused') {
    // Download is paused - check if it was auto-paused due to error
    let isAutoPaused = false;
    if (currentDownload.metadata) {
      try {
        const metadata = JSON.parse(currentDownload.metadata);
        isAutoPaused = metadata.auto_paused === true;
      } catch {
        // Ignore parse errors
      }
    }
    
    // If auto-paused, don't allow any status updates to override it (user must manually resume)
    // If manually paused, only allow updates that explicitly set status to paused
    if (isAutoPaused || status.status !== 'paused') {
      // Silently ignore status updates for paused downloads
      return;
    }
  }
  
  const existingDownload = database.prepare('SELECT metadata FROM downloads WHERE id = ?').get(downloadId);
  let existingMetadata = {};
  if (existingDownload && existingDownload.metadata) {
    try {
      existingMetadata = JSON.parse(existingDownload.metadata);
    } catch {
      // Ignore parse errors
    }
  }
  
  // If status is paused, update with pause reason and don't move to history
  if (status.status === 'paused') {
    const pausedMetadata = {
      ...existingMetadata,
      ...status,
      pause_reason: status.pause_reason || status.message || 'Paused by user',
      options: existingMetadata.options || {},
      paused_at: Date.now(),
    };
    
    // Update status, metadata, and all state fields
    database.prepare(`
      UPDATE downloads 
      SET status = ?, progress = ?, downloaded = ?, total = ?, speed = ?, metadata = ?
      WHERE id = ?
    `).run(
      'paused',
      status.progress || 0,
      status.downloaded || 0,
      status.total || 0,
      status.speed || status.download_rate || 0,
      JSON.stringify(pausedMetadata),
      downloadId
    );
    
    // Send update to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-update', {
        ...updateData,
        pause_reason: pausedMetadata.pause_reason,
      });
    }
    return; // Don't process further - download is paused
  }
  
  // If status is seeding (torrent completed), add to history but keep in downloads
  if (status.status === 'seeding' || (status.type === 'torrent' && status.progress >= 1.0)) {
    const download = database.prepare('SELECT * FROM downloads WHERE id = ?').get(downloadId);
    if (download) {
      // Check if already in history
      const existingHistory = database.prepare('SELECT * FROM download_history WHERE id = ?').get(downloadId);
      if (!existingHistory) {
        // Add to history but keep in downloads table
        const insertHistory = database.prepare(`
          INSERT OR REPLACE INTO download_history (id, source, output, type, size, completed_at, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        insertHistory.run(
          downloadId,
          download.source,
          download.output,
          download.type,
          download.downloaded || download.total || 0,
          Date.now(),
          download.metadata || ''
        );
      }
    }
  }
  
  const updatedMetadata = {
    ...existingMetadata,
    ...status,
    options: existingMetadata.options || {},
  };
  
  // Store error and info messages in metadata
  if (status.message) {
    if (!updatedMetadata.messages) {
      updatedMetadata.messages = [];
    }
    const messageType = status.status === 'error' ? 'error' : (status.status === 'info' ? 'info' : 'message');
    updatedMetadata.messages.push({
      time: Date.now(),
      type: messageType,
      text: status.message
    });
    // Keep only last 20 messages
    if (updatedMetadata.messages.length > 20) {
      updatedMetadata.messages = updatedMetadata.messages.slice(-20);
    }
  }
  
  // Determine the correct status
  // For torrents at 100%, force status to "seeding" if not already paused
  let finalStatus = status.status || 'downloading';
  
  // Check if torrent is already seeding in database - preserve that status
  const currentStatus = database.prepare('SELECT status FROM downloads WHERE id = ?').get(downloadId);
  const isAlreadySeeding = currentStatus && currentStatus.status === 'seeding';
  
  if (status.type === 'torrent') {
    // If torrent is already seeding, preserve that status unless explicitly changed
    if (isAlreadySeeding && status.status !== 'paused' && status.status !== 'failed') {
      finalStatus = 'seeding';
    } else if (status.status === 'seeding' || status.progress >= 1.0 || status.progress === 1) {
      // Torrent is complete - should be seeding (either explicit status or 100% progress)
      finalStatus = 'seeding';
    }
  }
  
  // For info/error status updates, don't change the main status if download is active
  // Exception: if torrent is seeding, preserve seeding status
  if (status.status === 'info' && finalStatus === 'downloading' && !isAlreadySeeding) {
    // Keep downloading status, just update metadata
    finalStatus = existingDownload ? (existingDownload.status === 'paused' ? 'paused' : 'downloading') : 'downloading';
  }
  
  const updateDownload = database.prepare(`
    UPDATE downloads 
    SET status = ?, progress = ?, downloaded = ?, total = ?, speed = ?, metadata = ?
    WHERE id = ?
  `);
  updateDownload.run(
    finalStatus,
    status.progress || 0,
    status.downloaded || 0,
    status.total || 0,
    status.speed || status.download_rate || 0,
    JSON.stringify(updatedMetadata),
    downloadId
  );
  
  storeTorrentState(database, status, downloadId);
  storeHttpState(database, status, downloadId);
  
  // Update the status in updateData to reflect the final status
  updateData.status = finalStatus;
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-update', updateData);
  }
}

ipcMain.handle('start-download', async (event, { source, output, options }) => {
  // Default to ~/Downloads if no output specified
  const outputPath = await resolveOutputPath(output);
  
  // Check if download already exists (same source + output) to prevent duplicates
  const db = await getDatabase();
  const downloadType = determineDownloadType(source);
  
  // Check for existing active download with same source and output
  const existingDownload = db.prepare(`
    SELECT * FROM downloads 
    WHERE source = ? AND output = ? 
    AND status NOT IN ('completed', 'failed', 'cancelled')
    ORDER BY started_at DESC
    LIMIT 1
  `).get(source, outputPath);
  
  let downloadId;
  if (existingDownload) {
    // Reuse existing download ID
    downloadId = existingDownload.id;
    
    // Update existing download to paused status (don't auto-start)
    const existingMetadata = existingDownload.metadata ? JSON.parse(existingDownload.metadata) : {};
    const updatedMetadata = {
      ...existingMetadata,
      options: options || existingMetadata.options || {},
      type: downloadType,
      pause_reason: 'Paused - click resume to start',
      paused_at: Date.now(),
    };
    
    db.prepare(`
      UPDATE downloads 
      SET status = 'paused', started_at = ?, metadata = ?, error = NULL
      WHERE id = ?
    `).run(Date.now(), JSON.stringify(updatedMetadata), downloadId);
    
    // If process exists, stop it first
    const existingProc = downloadProcesses.get(downloadId);
    if (existingProc) {
      try {
        existingProc.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 500));
        if (!existingProc.killed) {
          existingProc.kill('SIGKILL');
        }
      } catch (error) {
        // Ignore errors
      }
      downloadProcesses.delete(downloadId);
    }
  } else {
    // Create new download ID
    downloadId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Store options in metadata for resume
    const initialMetadata = {
      options: options || {},
      type: downloadType,
    };
    
    const insertDownload = db.prepare(`
      INSERT OR REPLACE INTO downloads (id, source, output, type, status, started_at, metadata)
      VALUES (?, ?, ?, ?, 'paused', ?, ?)
    `);
    
    // Set pause reason for new downloads
    initialMetadata.pause_reason = 'Paused - click resume to start';
    initialMetadata.paused_at = Date.now();
    
    insertDownload.run(downloadId, source, outputPath, downloadType, Date.now(), JSON.stringify(initialMetadata));
  }
  
  // Ensure output directory exists
  // For HTTP downloads, outputPath should ALWAYS be treated as a file path
  // (unless it explicitly ends with a path separator)
  // For torrent downloads, outputPath can be a directory
  if (downloadType === 'http') {
    // HTTP downloads are always files - create parent directory only
    const parentDir = path.dirname(outputPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  } else {
    // For torrents, check if it's a file or directory
    try {
      const outputStat = fs.statSync(outputPath);
      if (!outputStat.isDirectory()) {
        // It's a file, create parent directory
        const parentDir = path.dirname(outputPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
      }
    } catch {
      // Path doesn't exist - check if it looks like a directory
      // Only treat as directory if it ends with path separator
      const isDirectory = outputPath.endsWith(path.sep) || outputPath.endsWith('/');
      if (isDirectory) {
        // Explicitly a directory - create it
        if (!fs.existsSync(outputPath)) {
          fs.mkdirSync(outputPath, { recursive: true });
        }
      } else {
        // Assume it's a file - create parent directory
        const parentDir = path.dirname(outputPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
      }
    }
  }
  
  // Don't start the download immediately - it should be paused
  // The download will only start when user clicks resume
  // Notify UI that download was created in paused state
  if (mainWindow && !mainWindow.isDestroyed()) {
    const db = await getDatabase();
    const download = db.prepare('SELECT * FROM downloads WHERE id = ?').get(downloadId);
    const metadata = download.metadata ? JSON.parse(download.metadata) : {};
    
    mainWindow.webContents.send('download-update', {
      downloadId,
      download_id: downloadId,
      source,
      output: outputPath,
      type: downloadType,
      status: 'paused',
      progress: 0,
      downloaded: 0,
      total: 0,
      speed: 0,
      pause_reason: 'Paused - click resume to start',
      ...metadata,
    });
  }
  
  return { success: true, downloadId };
});

ipcMain.handle('stop-download', async (event, downloadId) => {
  const proc = downloadProcesses.get(downloadId);
  if (proc) {
    proc.kill();
    downloadProcesses.delete(downloadId);
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('remove-download', async (event, downloadId) => {
  // Stop process if running
  const proc = downloadProcesses.get(downloadId);
  if (proc) {
    try {
      proc.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 500));
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    } catch (error) {
      // Ignore errors
    }
    downloadProcesses.delete(downloadId);
  }
  
  // Get download info before deleting from database
  const db = await getDatabase();
  const download = db.prepare('SELECT * FROM downloads WHERE id = ?').get(downloadId);
  
  // Delete from database
  db.prepare('DELETE FROM downloads WHERE id = ?').run(downloadId);
  
  // Delete related state tables
  db.prepare('DELETE FROM torrent_state WHERE download_id = ?').run(downloadId);
  db.prepare('DELETE FROM http_state WHERE download_id = ?').run(downloadId);
  
  // Delete partial files
  if (download) {
    try {
      await deletePartialFiles(downloadId, download.output, download.type);
    } catch (error) {
      safeConsoleError(`Error deleting partial files for download ${downloadId}:`, error.message);
    }
  }
  
  // Notify renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-removed', { downloadId });
  }
  
  return { success: true };
});

ipcMain.handle('pause-download', async (event, downloadId) => {
  const proc = downloadProcesses.get(downloadId);
  if (proc) {
    // Send SIGSTOP to pause the process (Unix-like systems)
    // On Windows, this will be handled differently
    const isUnix = process.platform !== 'win32';
    if (isUnix) {
      proc.kill('SIGSTOP');
    } else {
      // Windows doesn't support SIGSTOP, so we'll need to track paused state
      // For now, just mark as paused in the database
    }
    
    // Update database status
    try {
      const db = await getDatabase();
      const download = db.prepare('SELECT * FROM downloads WHERE id = ?').get(downloadId);
      const metadata = download.metadata ? JSON.parse(download.metadata) : {};
      const updatedMetadata = {
        ...metadata,
        pause_reason: 'Paused by user',
        paused_at: Date.now(),
        options: metadata.options || {},
      };
      
      db.prepare(`
        UPDATE downloads 
        SET status = ?, metadata = ?, progress = ?, downloaded = ?, total = ?, speed = ?
        WHERE id = ?
      `).run(
        'paused',
        JSON.stringify(updatedMetadata),
        download.progress || 0,
        download.downloaded || 0,
        download.total || 0,
        0, // Reset speed to 0 when paused
        downloadId
      );
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-update', {
          download_id: downloadId,
          downloadId,
          status: 'paused',
          pause_reason: 'Paused by user',
          progress: download.progress || 0,
          downloaded: download.downloaded || 0,
          total: download.total || 0,
          speed: 0,
          ...updatedMetadata,
        });
      }
    } catch (error) {
      safeConsoleError('Error pausing download:', error.message);
    }
  } else {
    // Process doesn't exist - update database only
    try {
      const db = await getDatabase();
      const download = db.prepare('SELECT * FROM downloads WHERE id = ?').get(downloadId);
      if (download && download.status !== 'paused') {
        const metadata = download.metadata ? JSON.parse(download.metadata) : {};
        const updatedMetadata = {
          ...metadata,
          pause_reason: 'Paused by user',
          paused_at: Date.now(),
          options: metadata.options || {},
        };
        
        db.prepare(`
          UPDATE downloads 
          SET status = ?, metadata = ?
          WHERE id = ?
        `).run('paused', JSON.stringify(updatedMetadata), downloadId);
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-update', {
            download_id: downloadId,
            downloadId,
            status: 'paused',
            pause_reason: 'Paused by user',
            progress: download.progress || 0,
            downloaded: download.downloaded || 0,
            total: download.total || 0,
            speed: 0,
            ...updatedMetadata,
          });
        }
      }
    } catch (error) {
      safeConsoleError('Error pausing download:', error.message);
    }
  }
  
  return { success: true };
});

ipcMain.handle('resume-download', async (event, downloadId) => {
  const proc = downloadProcesses.get(downloadId);
  
  // If process exists, resume it
  if (proc) {
    // Send SIGCONT to resume the process (Unix-like systems)
    const isUnix = process.platform !== 'win32';
    if (isUnix) {
      proc.kill('SIGCONT');
    }
    
    // Update database status
    try {
      const db = await getDatabase();
      db.prepare('UPDATE downloads SET status = ? WHERE id = ?').run('downloading', downloadId);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-update', {
          download_id: downloadId,
          downloadId,
          status: 'downloading'
        });
      }
    } catch (error) {
      safeConsoleError('Error resuming download:', error.message);
    }
    
    return { success: true };
  }
  
  // Process doesn't exist (e.g., after app restart) - restart the download
  try {
    const db = await getDatabase();
    const download = db.prepare('SELECT * FROM downloads WHERE id = ?').get(downloadId);
    
    if (!download) {
      return { success: false, error: 'Download not found' };
    }
    
    if (download.status !== 'paused') {
      return { success: false, error: 'Download is not paused' };
    }
    
    const metadata = download.metadata ? JSON.parse(download.metadata) : {};
    const options = metadata.options || {};
    
    const args = buildCommandArgs(download.source, download.output, download.id, options);
    const goBinary = verifyAndNormalizeBinary(findGoBinary());
    
    if (!goBinary || !fs.existsSync(goBinary)) {
      safeConsoleError('Go binary not found for resume:', goBinary);
      return { success: false, error: 'Go binary not found' };
    }
    
    // For cwd, we need a real directory, not inside ASAR
    let workingDir;
    if (app.isPackaged) {
      workingDir = os.homedir();
    } else {
      workingDir = path.join(__dirname, '..');
    }
    
    try {
      const newProc = spawn(goBinary, args, {
        cwd: workingDir,
        env: { ...process.env }
      });
      
      // Check if process spawned successfully
      if (!newProc || newProc.pid === undefined) {
        safeConsoleError('Failed to spawn Go process for resume');
        return { success: false, error: 'Failed to start download process' };
      }
      
      downloadProcesses.set(download.id, newProc);
      setupRestartedDownloadHandlers(newProc, download.id, metadata, download);
      
      // Handle process errors immediately
      newProc.on('error', (error) => {
        safeConsoleError(`Error spawning Go process for download ${download.id}:`, error.message);
        downloadProcesses.delete(download.id);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-update', {
            downloadId: download.id,
            download_id: download.id,
            status: 'error',
            error: `Failed to start download: ${error.message}`
          });
        }
      });
    } catch (spawnError) {
      safeConsoleError('Exception spawning Go process:', spawnError.message);
      return { success: false, error: `Failed to spawn process: ${spawnError.message}` };
    }
    
    // Clear auto_paused flag when user manually resumes
    const updatedMetadata = {
      ...metadata,
      auto_paused: false,
      pause_reason: null,
      paused_at: null,
    };
    
    // Update database status and clear pause metadata
    db.prepare(`
      UPDATE downloads 
      SET status = ?, metadata = ?
      WHERE id = ?
    `).run('downloading', JSON.stringify(updatedMetadata), downloadId);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-update', {
        download_id: downloadId,
        downloadId,
        status: 'downloading',
        // Include current progress so UI shows correct state
        progress: download.progress || 0,
        downloaded: download.downloaded || 0,
        total: download.total || 0,
      });
    }
    
    return { success: true };
  } catch (error) {
    safeConsoleError('Error restarting paused download:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-active-downloads', async () => {
  try {
    const db = await getDatabase();
    const downloads = db.prepare(`
      SELECT * FROM downloads 
      WHERE status NOT IN ('completed', 'cancelled')
      ORDER BY started_at DESC
    `).all();
    
    return downloads.map(download => {
      const metadata = download.metadata ? JSON.parse(download.metadata) : {};
      return {
        ...download,
        metadata,
      };
    });
  } catch (error) {
    safeConsoleError('Error getting active downloads:', error.message);
    return [];
  }
});

ipcMain.handle('get-download-history', async () => {
  const db = await getDatabase();
  
  // Get history items
  const history = db.prepare(`
    SELECT * FROM download_history 
    ORDER BY completed_at DESC 
    LIMIT 100
  `).all();
  
  // Also include active seeding torrents (they're in both downloads and history)
  const seedingTorrents = db.prepare(`
    SELECT d.*, h.completed_at 
    FROM downloads d
    LEFT JOIN download_history h ON d.id = h.id
    WHERE d.status = 'seeding' AND d.type = 'torrent'
    ORDER BY h.completed_at DESC, d.started_at DESC
  `).all();
  
  // Combine and deduplicate by id
  const historyMap = new Map();
  
  // Add history items
  history.forEach(item => {
    historyMap.set(item.id, {
      id: item.id,
      source: item.source,
      output: item.output,
      type: item.type,
      size: item.size,
      completedAt: item.completed_at,
      metadata: item.metadata ? JSON.parse(item.metadata) : {},
      isSeeding: false
    });
  });
  
  // Add/update with seeding torrents
  seedingTorrents.forEach(item => {
    const existing = historyMap.get(item.id);
    if (existing) {
      // Update existing history item to mark as seeding
      existing.isSeeding = true;
      existing.status = 'seeding';
      existing.progress = item.progress || 1.0;
      existing.downloaded = item.downloaded || item.size || 0;
      existing.total = item.total || item.size || 0;
      existing.speed = item.speed || 0;
      if (item.metadata) {
        try {
          existing.metadata = { ...existing.metadata, ...JSON.parse(item.metadata) };
        } catch {}
      }
    } else {
      // Add new seeding torrent to history
      historyMap.set(item.id, {
        id: item.id,
        source: item.source,
        output: item.output,
        type: item.type,
        size: item.downloaded || item.total || 0,
        completedAt: item.completed_at || item.started_at,
        metadata: item.metadata ? JSON.parse(item.metadata) : {},
        isSeeding: true,
        status: 'seeding',
        progress: item.progress || 1.0,
        downloaded: item.downloaded || 0,
        total: item.total || 0,
        speed: item.speed || 0,
      });
    }
  });
  
  return Array.from(historyMap.values());
});

ipcMain.handle('clear-download-history', async () => {
  try {
    const db = await getDatabase();
    db.prepare('DELETE FROM download_history').run();
    return { success: true };
  } catch (error) {
    safeConsoleError('Error clearing download history:', error.message);
    return { success: false, error: error.message };
  }
});

// Helper function to calculate directory size recursively
function calculateDirSize(dirPath) {
  let totalSize = 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          totalSize += calculateDirSize(filePath);
        } else {
          totalSize += stats.size;
        }
      } catch (err) {
        // Skip files we can't access
      }
    }
  } catch (err) {
    // Skip directories we can't access
  }
  return totalSize;
}

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

ipcMain.handle('get-junk-data-size', async () => {
  let totalSize = 0;
  const junkPaths = [];
  
  try {
    // Get default download path
    const db = await getDatabase();
    const defaultSettings = getDefaultSettings();
    const settings = db.prepare('SELECT key, value FROM settings').all();
    const dbSettings = {};
    for (const row of settings) {
      try {
        dbSettings[row.key] = JSON.parse(row.value);
      } catch {
        dbSettings[row.key] = row.value;
      }
    }
    const downloadPath = dbSettings.defaultDownloadPath || defaultSettings.defaultDownloadPath || os.homedir() + '/Downloads';
    
    // Scan for .accelara-temp-* directories
    if (fs.existsSync(downloadPath)) {
      try {
        const entries = fs.readdirSync(downloadPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith('.accelara-temp-')) {
            const tempDir = path.join(downloadPath, entry.name);
            const size = calculateDirSize(tempDir);
            totalSize += size;
            junkPaths.push(tempDir);
          }
        }
      } catch (err) {
        // Skip if we can't read directory
      }
    }
    
    // Also scan common download locations
    const commonPaths = [
      os.homedir() + '/Downloads',
      os.homedir() + '/Desktop',
    ];
    
    for (const commonPath of commonPaths) {
      if (fs.existsSync(commonPath) && commonPath !== downloadPath) {
        try {
          const entries = fs.readdirSync(commonPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name.startsWith('.accelara-temp-')) {
              const tempDir = path.join(commonPath, entry.name);
              const size = calculateDirSize(tempDir);
              totalSize += size;
              junkPaths.push(tempDir);
            }
          }
        } catch (err) {
          // Skip if we can't read directory
        }
      }
    }
  } catch (error) {
    console.error('Error calculating junk data size:', error.message);
  }
  
  return {
    size: totalSize,
    sizeFormatted: formatBytes(totalSize),
    paths: junkPaths.length,
  };
});

ipcMain.handle('clear-junk-data', async () => {
  let deletedSize = 0;
  let deletedCount = 0;
  
  try {
    // Get default download path
    const db = await getDatabase();
    const defaultSettings = getDefaultSettings();
    const settings = db.prepare('SELECT key, value FROM settings').all();
    const dbSettings = {};
    for (const row of settings) {
      try {
        dbSettings[row.key] = JSON.parse(row.value);
      } catch {
        dbSettings[row.key] = row.value;
      }
    }
    const downloadPath = dbSettings.defaultDownloadPath || defaultSettings.defaultDownloadPath || os.homedir() + '/Downloads';
    
    // Function to delete temp directory and calculate size
    const deleteTempDir = (tempDir) => {
      try {
        const size = calculateDirSize(tempDir);
        fs.rmSync(tempDir, { recursive: true, force: true });
        deletedSize += size;
        deletedCount++;
      } catch (err) {
        // Skip if we can't delete
      }
    };
    
    // Scan for .accelara-temp-* directories in download path
    if (fs.existsSync(downloadPath)) {
      try {
        const entries = fs.readdirSync(downloadPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith('.accelara-temp-')) {
            const tempDir = path.join(downloadPath, entry.name);
            deleteTempDir(tempDir);
          }
        }
      } catch (err) {
        // Skip if we can't read directory
      }
    }
    
    // Also scan common download locations
    const commonPaths = [
      os.homedir() + '/Downloads',
      os.homedir() + '/Desktop',
    ];
    
    for (const commonPath of commonPaths) {
      if (fs.existsSync(commonPath) && commonPath !== downloadPath) {
        try {
          const entries = fs.readdirSync(commonPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name.startsWith('.accelara-temp-')) {
              const tempDir = path.join(commonPath, entry.name);
              deleteTempDir(tempDir);
            }
          }
        } catch (err) {
          // Skip if we can't read directory
        }
      }
    }
  } catch (error) {
    console.error('Error clearing junk data:', error.message);
    return { success: false, error: error.message, deletedSize: 0, deletedSizeFormatted: '0 B' };
  }
  
  return {
    success: true,
    deletedSize,
    deletedSizeFormatted: formatBytes(deletedSize),
    deletedCount,
  };
});

ipcMain.handle('save-speed-test-result', async (event, result) => {
  const db = await getDatabase();
  const testId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const insertTest = db.prepare(`
    INSERT INTO speed_test_results (
      id, timestamp, download_speed, upload_speed,
      latency_avg, latency_min, latency_max,
      location_city, location_region, location_country, location_isp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  insertTest.run(
    testId,
    result.timestamp || Date.now(),
    result.downloadSpeed || 0,
    result.uploadSpeed || 0,
    result.latency?.average || null,
    result.latency?.min || null,
    result.latency?.max || null,
    result.location?.city || null,
    result.location?.region || null,
    result.location?.country || null,
    result.location?.isp || null
  );
  
  return { success: true, testId };
});

ipcMain.handle('get-speed-test-results', async (event, limit = 100) => {
  const db = await getDatabase();
  const results = db.prepare(`
    SELECT * FROM speed_test_results
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit);
  
  return results.map(row => ({
    id: row.id,
    timestamp: row.timestamp,
    downloadSpeed: row.download_speed,
    uploadSpeed: row.upload_speed,
    latency: row.latency_avg ? {
      average: row.latency_avg,
      min: row.latency_min,
      max: row.latency_max,
    } : null,
    location: row.location_city ? {
      city: row.location_city,
      region: row.location_region,
      country: row.location_country,
      isp: row.location_isp,
    } : null,
  }));
});

ipcMain.handle('clear-speed-test-results', async () => {
  const db = await getDatabase();
  db.prepare('DELETE FROM speed_test_results').run();
  return { success: true };
});

ipcMain.handle('focus-window', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('start-speed-test', async (event, { testType = 'full' }) => {
  console.log('=== start-speed-test: Starting ===');
  console.log('Test type:', testType);
  
  const foundBinary = findGoBinary();
  console.log('findGoBinary() returned:', foundBinary);
  
  const goBinary = verifyAndNormalizeBinary(foundBinary);
  console.log('verifyAndNormalizeBinary() returned:', goBinary);
  console.log('About to spawn with path:', goBinary);
  console.log('Path exists?', fs.existsSync(goBinary));
  console.log('Path is file?', fs.existsSync(goBinary) ? fs.statSync(goBinary).isFile() : 'N/A');
  console.log('Path is directory?', fs.existsSync(goBinary) ? fs.statSync(goBinary).isDirectory() : 'N/A');
  
  const args = ['--speedtest', '--test-type', testType];
  console.log('Spawning process with:', goBinary, args);
  
  // For cwd, we need a real directory, not inside ASAR
  // In packaged apps, use the user's home directory or a temp directory
  let workingDir;
  if (app.isPackaged) {
    // In packaged app, use home directory or temp directory
    workingDir = os.homedir();
  } else {
    // In dev, use project root
    workingDir = path.join(__dirname, '..');
  }
  console.log('Working directory for spawn:', workingDir);
  
  const proc = spawn(goBinary, args, {
    cwd: workingDir,
  });
  
  proc.on('error', (error) => {
    safeConsoleError('=== spawn error ===');
    safeConsoleError('Error code:', error.code);
    safeConsoleError('Error message:', error.message);
    safeConsoleError('Binary path used:', goBinary);
    safeConsoleError('Path exists?', fs.existsSync(goBinary));
    if (fs.existsSync(goBinary)) {
      const stats = fs.statSync(goBinary);
      safeConsoleError('Path stats:', {
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        mode: stats.mode.toString(8),
        size: stats.size
      });
    }
  });

  const testId = `speedtest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  speedTestProcesses.set(testId, proc);

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const result = JSON.parse(line);
        mainWindow.webContents.send('speed-test-update', {
          testId,
          ...result,
        });
      } catch (parseError) {
        // Ignore non-JSON lines
      }
    }
  });

  proc.stderr.on('data', (data) => {
    // Log errors but don't send to renderer
    try {
      const errorMsg = data.toString().trim();
      if (errorMsg) {
        console.error(`═══════════════════════════════════════════════════════════`);
        console.error(`[speed-test] Go Error:`);
        console.error(`  ${errorMsg}`);
        console.error(`═══════════════════════════════════════════════════════════`);
        writeToGoLog('ERROR', 'speed-test', errorMsg);
      }
    } catch (logError) {
      // Ignore EPIPE errors
      if (logError.code !== 'EPIPE') {
        console.error('Error logging speed test stderr:', logError.message);
        writeToGoLog('ERROR', 'speed-test', `Error logging stderr: ${logError.message}`);
      }
    }
  });

  proc.on('close', (code) => {
    speedTestProcesses.delete(testId);
    mainWindow.webContents.send('speed-test-complete', {
      testId,
      code,
    });
  });

  proc.on('error', (error) => {
    speedTestProcesses.delete(testId);
    mainWindow.webContents.send('speed-test-error', {
      testId,
      error: error.message,
    });
  });

  return { testId, success: true };
});

ipcMain.handle('stop-speed-test', async (event, testId) => {
  const proc = speedTestProcesses.get(testId);
  if (proc) {
    try {
      if (process.platform === 'win32') {
        proc.kill();
      } else {
        proc.kill('SIGTERM');
      }
      speedTestProcesses.delete(testId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'Test not found' };
});

ipcMain.handle('get-settings', async () => {
  const db = await getDatabase();
  const defaultSettings = getDefaultSettings();
  
  // Get settings from database
  const settings = db.prepare('SELECT key, value FROM settings').all();
  const dbSettings = {};
  for (const row of settings) {
    try {
      dbSettings[row.key] = JSON.parse(row.value);
    } catch (parseError) {
      // If JSON parse fails, use raw value as fallback
      console.debug(`Failed to parse setting ${row.key}, using raw value:`, parseError.message);
      dbSettings[row.key] = row.value;
    }
  }
  
  // Merge with defaults
  return { ...defaultSettings, ...dbSettings };
});

ipcMain.handle('save-settings', async (event, settings) => {
  const db = await getDatabase();
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  
  for (const [key, value] of Object.entries(settings)) {
    insertSetting.run(key, JSON.stringify(value));
  }
  
  return { success: true };
});

ipcMain.handle('select-torrent-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Torrent Files', extensions: ['torrent'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('select-download-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: path.join(os.homedir(), 'Downloads'),
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('open-folder', async (event, folderPath) => {
  if (!folderPath) {
    return { success: false, error: 'No path provided' };
  }
  
  try {
    // Resolve to absolute path
    let resolvedPath = path.isAbsolute(folderPath) 
      ? folderPath 
      : path.resolve(folderPath);
    
    // Check if path exists
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: 'Path does not exist' };
    }
    
    // For directories, check if it's a torrent download directory
    // Torrents download to a subdirectory with the torrent name
    const stats = fs.statSync(resolvedPath);
    if (stats.isDirectory()) {
      // Check if this directory contains a single subdirectory (likely the torrent folder)
      // This helps highlight the actual downloaded folder for torrents
      try {
        const entries = fs.readdirSync(resolvedPath);
        // If there's exactly one directory entry, use that as the target
        if (entries.length === 1) {
          const subPath = path.join(resolvedPath, entries[0]);
          const subStats = fs.statSync(subPath);
          if (subStats.isDirectory()) {
            resolvedPath = subPath;
          }
        }
      } catch {
        // If we can't read the directory, just use the original path
      }
    }
    
    // Use shell.showItemInFolder to highlight the file/folder
    // This works for both files and directories and will highlight the item
    shell.showItemInFolder(resolvedPath);
    return { success: true };
  } catch (error) {
    console.error('Error opening folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-system-theme', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

// Listen for system theme changes
nativeTheme.on('updated', () => {
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('system-theme-changed', theme);
  }
});

function getDefaultSettings() {
  return {
    concurrency: 8,
    chunkSize: '4MB',
    rateLimit: null,
    uploadLimit: null,
    sequentialMode: false,
    theme: 'system', // Default to system theme
    connectTimeout: 15,
    readTimeout: 60,
    retries: 5,
    defaultDownloadPath: path.join(os.homedir(), 'Downloads'),
    torrentPort: 42069, // Default BitTorrent port
  };
}


// Browser Integration Server
// Receives download requests from browser extensions
function startBrowserServer() {
  if (browserServer) {
    return; // Already started
  }
  
  browserServer = http.createServer((req, res) => {
    // Enable CORS for browser extensions
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    
    if (req.method === 'POST' && req.url === '/download') {
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          handleBrowserDownload(data);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          console.error('Error processing browser download:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: error.message }));
        }
      });
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  
  browserServer.listen(BROWSER_SERVER_PORT, 'localhost', () => {
    try {
      console.log(`Browser integration server listening on http://localhost:${BROWSER_SERVER_PORT}`);
    } catch (error) {
      if (error.code !== 'EPIPE') {
        // Only log if it's not an EPIPE error (broken pipe)
        console.error('Error logging server status:', error);
      }
    }
  });
  
  browserServer.on('error', (error) => {
    try {
      if (error.code === 'EADDRINUSE') {
        console.log(`Port ${BROWSER_SERVER_PORT} already in use, browser integration may not work`);
      } else {
        console.error('Browser server error:', error);
      }
    } catch (logError) {
      if (logError.code !== 'EPIPE') {
        // Only log if it's not an EPIPE error
      }
    }
  });
}

// Handle download requests from browser extensions
function handleBrowserDownload(data) {
  try {
    console.log('Received browser download request:', data);
  } catch (error) {
    if (error.code !== 'EPIPE') {
      // Only log if it's not an EPIPE error
    }
  }
  
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn('Main window not available, cannot handle browser download');
    return;
  }
  
  // Ensure window is visible
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  
  if (data.type === 'magnet') {
    // Handle magnet link
    const magnetUrl = data.url || data.source;
    if (magnetUrl && magnetUrl.startsWith('magnet:')) {
      handleMagnetLink(magnetUrl);
    }
  } else if (data.type === 'download') {
    // Handle HTTP/FTP download
    const url = data.url || data.source;
    const filename = data.filename;
    
    if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('ftp://'))) {
      // Send to renderer to open download modal
      if (mainWindow.webContents) {
        mainWindow.webContents.send('external-download', {
          type: 'http',
          source: url,
          filename: filename,
          referrer: data.referrer,
          mimeType: data.mimeType
        });
      }
    }
  }
}
