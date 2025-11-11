const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme, nativeImage, Tray } = require('electron');
const path = require('node:path');
const { spawn, exec } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const { getDatabase } = require('./database');

// Minimal startup logging
console.log('Electron starting...');

// Set app name explicitly
app.setName('ACCELARA');

let mainWindow;
let downloadProcesses = new Map();
let speedTestProcesses = new Map();
let pendingArgs = null;
let tray = null;

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
    console.log('Loading file:', filePath);
    console.log('App path:', appPath);
    
    mainWindow.loadFile(filePath).catch(err => {
      try {
        console.error('Error loading file:', err);
        // Fallback: try relative path from __dirname
        const fallbackPath = path.join(__dirname, '../dist/index.html');
        console.log('Trying fallback path:', fallbackPath);
        mainWindow.loadFile(fallbackPath).catch(fallbackErr => {
          console.error('Failed to load fallback path:', fallbackErr);
        });
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
    console.log('Window closed');
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

// Graceful shutdown - stop all active downloads
async function gracefulShutdown() {
  console.log('Gracefully shutting down...');
  
  // Stop all active download processes
  for (const [downloadId, proc] of downloadProcesses.entries()) {
    try {
      proc.kill('SIGTERM');
      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Force kill if still running
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    } catch (error) {
      console.error(`Error stopping download ${downloadId}:`, error.message);
    }
  }
  
  downloadProcesses.clear();
  console.log('All downloads stopped');
}

// Helper function to setup process handlers for a restarted download
function setupRestartedDownloadHandlers(proc, downloadId, metadata, download) {
  let isProcessActive = true;
  
  proc.stdout.on('data', async (data) => {
    if (!isProcessActive) return;
    
    try {
      const line = data.toString().trim();
      if (line.startsWith('{')) {
        const status = JSON.parse(line);
        await processStatusUpdate(status, downloadId);
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
      const errorMsg = data.toString().trim();
      if (errorMsg) {
        console.error(`Go error: ${errorMsg}`);
      }
    } catch (error) {
      if (error.code !== 'EPIPE') {
        // Only log if it's not an EPIPE error
      }
    }
  });
  
  proc.on('error', (error) => {
    isProcessActive = false;
    try {
      console.error(`Failed to restart Go process: ${error.message}`);
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
      playCompletionSound();
      await moveToHistory(downloadId);
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
    mainWindow.webContents.send('download-update', {
      downloadId: download.id,
      download_id: download.id,
      ...metadata,
      status: download.status || 'downloading',
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
    const activeDownloads = db.prepare(`
      SELECT * FROM downloads 
      WHERE status NOT IN ('completed', 'failed', 'cancelled')
      ORDER BY started_at DESC
    `).all();
    
    if (activeDownloads.length === 0) {
      return;
    }
    
    console.log(`Reattaching to ${activeDownloads.length} active download(s)...`);
    
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      for (const download of activeDownloads) {
        try {
          const metadata = download.metadata ? JSON.parse(download.metadata) : {};
          const options = metadata.options || {};
          
          const args = buildCommandArgs(download.source, download.output, download.id, options);
          const goBinary = findGoBinary();
          
          const proc = spawn(goBinary, args, {
            cwd: path.join(__dirname, '..'),
            env: { ...process.env }
          });
          
          downloadProcesses.set(download.id, proc);
          setupRestartedDownloadHandlers(proc, download.id, metadata, download);
          
          console.log(`Restarted download: ${download.id}`);
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

if (gotTheLock) {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    
    // Handle command line arguments
    handleArgs(commandLine.slice(1));
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (mainWindow) {
      handleMagnetLink(url);
    } else {
      pendingArgs = { type: 'magnet', url };
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
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
    const isDev = !app.isPackaged && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV);
    setDockIcon(isDev);
    
    createWindow();

    // Reattach to existing downloads from database (wait for window to be ready)
    setTimeout(() => {
      reattachToDownloads().catch((error) => {
        console.error('Error reattaching to downloads:', error.message);
      });
    }, 1000);

    // Handle initial arguments (Windows file associations come through argv)
    const args = process.argv.slice(1);
    if (args.length > 0) {
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
  });
} else {
  app.quit();
}

function handleArgs(args) {
  for (const arg of args) {
    if (!arg) continue;
    
    // Handle magnet links
    if (arg.startsWith('magnet:')) {
      handleMagnetLink(arg);
    } 
    // Handle .torrent files (Windows passes full path, macOS/Linux might pass relative)
    else if (arg.toLowerCase().endsWith('.torrent')) {
      handleTorrentFile(arg);
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
    
    // Normal quit behavior
    if (process.platform !== 'darwin') {
      gracefulShutdown().then(() => {
        app.quit();
      });
    }
  });
});

// Set as default protocol handler (macOS/Linux)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('magnet', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('magnet');
}

// IPC Handlers
ipcMain.handle('inspect-torrent', async (event, source) => {
  const { spawn } = require('node:child_process');
  const goBinary = path.resolve(__dirname, '../bin/api-wrapper' + (process.platform === 'win32' ? '.exe' : ''));
  
  if (!fs.existsSync(goBinary)) {
    throw new Error('Go binary not found');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(goBinary, ['--inspect', '--source', source], {
      cwd: path.join(__dirname, '..'),
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
  const goBinary = path.resolve(__dirname, '../bin/api-wrapper' + (process.platform === 'win32' ? '.exe' : ''));
  
  if (!fs.existsSync(goBinary)) {
    throw new Error('Go binary not found');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(goBinary, ['--http-info', '--source', source], {
      cwd: path.join(__dirname, '..'),
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
  
  // Try multiple possible locations
  const possiblePaths = [
    // 1. Development path (relative to __dirname)
    path.resolve(__dirname, '../bin', binaryName),
    // 2. Production path (in Resources/bin) - primary production path
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', binaryName) : null,
    // 3. Alternative production path (if resourcesPath points elsewhere)
    process.resourcesPath ? path.join(process.resourcesPath, '..', 'Resources', 'bin', binaryName) : null,
    // 4. Using app.getPath('exe') to find app bundle location (macOS)
    process.platform === 'darwin' && app && typeof app.getPath === 'function' 
      ? path.join(path.dirname(app.getPath('exe')), '..', 'Resources', 'bin', binaryName) 
      : null,
    // 5. Current working directory
    path.join(process.cwd(), 'bin', binaryName),
  ].filter(Boolean);
  
  // Log paths being checked (only in production for debugging)
  if (app.isPackaged) {
    try {
      console.log('Looking for Go binary. Resources path:', process.resourcesPath);
      console.log('Checking paths:', possiblePaths.slice(0, 3).join(', '));
    } catch {
      // Ignore logging errors
    }
  }
  
  // Check each path in order
  for (const possiblePath of possiblePaths) {
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
      console.log('Found Go binary at:', possiblePath);
      return possiblePath;
    }
  }
  
  // None found - throw error with all attempted paths
  const errorMsg = `Go binary not found. Tried paths:\n${possiblePaths.map(p => `  - ${p}`).join('\n')}\n\nResources path: ${process.resourcesPath}\nPlease ensure the binary is built and included in the app bundle.`;
  try {
    console.error(errorMsg);
  } catch (logError) {
    // Ignore EPIPE errors from console
    if (logError.code !== 'EPIPE') {
      // Only log if it's not an EPIPE error
    }
  }
  throw new Error(`Go binary not found. Please run 'make build-api' to build it.`);
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

ipcMain.handle('start-download', async (event, { source, output, options }) => {
  const downloadId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Default to ~/Downloads if no output specified
  const outputPath = await resolveOutputPath(output);
  
  // Ensure output directory exists
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }
  
  const args = buildCommandArgs(source, outputPath, downloadId, options);
  const goBinary = findGoBinary();
  console.log('Using Go binary:', goBinary);

  // Determine download type and save to database
  const downloadType = determineDownloadType(source);
  const db = await getDatabase();
  
  // Store options in metadata for resume
  const initialMetadata = {
    options: options || {},
    type: downloadType,
  };
  
  const insertDownload = db.prepare(`
    INSERT OR REPLACE INTO downloads (id, source, output, type, status, started_at, metadata)
    VALUES (?, ?, ?, ?, 'initializing', ?, ?)
  `);
  insertDownload.run(downloadId, source, outputPath, downloadType, Date.now(), JSON.stringify(initialMetadata));

  const proc = spawn(goBinary, args, {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env }
  });

  downloadProcesses.set(downloadId, proc);

  let isProcessActive = true;

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
      };
      database.prepare('UPDATE downloads SET status = ?, metadata = ? WHERE id = ?').run(
        'paused',
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
    
    const updatedMetadata = {
      ...existingMetadata,
      ...status,
      options: existingMetadata.options || {},
    };
    
    const updateDownload = database.prepare(`
      UPDATE downloads 
      SET status = ?, progress = ?, downloaded = ?, total = ?, speed = ?, metadata = ?
      WHERE id = ?
    `);
    updateDownload.run(
      status.status || 'downloading',
      status.progress || 0,
      status.downloaded || 0,
      status.total || 0,
      status.speed || status.download_rate || 0,
      JSON.stringify(updatedMetadata),
      downloadId
    );
    
    storeTorrentState(database, status, downloadId);
    storeHttpState(database, status, downloadId);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-update', updateData);
    }
  }

  proc.stdout.on('data', async (data) => {
    if (!isProcessActive) return;
    
    try {
      const line = data.toString().trim();
      if (line.startsWith('{')) {
        const status = JSON.parse(line);
        await processStatusUpdate(status, downloadId);
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
      const errorMsg = data.toString().trim();
      if (errorMsg) {
        console.error(`Go error: ${errorMsg}`);
      }
    } catch (error) {
      // Ignore EPIPE errors from console - this is intentional
      if (error.code !== 'EPIPE') {
        // Only log if it's not an EPIPE error
      }
    }
  });

  proc.on('error', (error) => {
    isProcessActive = false;
    try {
      console.error(`Failed to start Go process: ${error.message}`);
    } catch (logError) {
      // Ignore EPIPE errors from console - this is intentional
      if (logError.code !== 'EPIPE') {
        // Only log if it's not an EPIPE error
      }
    }
  });

  // Helper function to move completed download to history
  async function moveToHistory(downloadId) {
    try {
      const database = await getDatabase();
      const download = database.prepare('SELECT * FROM downloads WHERE id = ?').get(downloadId);
      if (download) {
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
        database.prepare('DELETE FROM downloads WHERE id = ?').run(downloadId);
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

  proc.on('close', async (code) => {
    isProcessActive = false;
    downloadProcesses.delete(downloadId);
    
    // Remove event listeners to prevent further writes
    proc.stdout.removeAllListeners('data');
    proc.stderr.removeAllListeners('data');
    
    // Move to history on completion
    if (code === 0) {
      // Play completion sound
      playCompletionSound();
      await moveToHistory(downloadId);
    }
    
    notifyDownloadComplete(downloadId, code, outputPath);
  });

  return { downloadId };
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
      db.prepare('UPDATE downloads SET status = ? WHERE id = ?').run('paused', downloadId);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-update', {
          download_id: downloadId,
          downloadId,
          status: 'paused'
        });
      }
    } catch (error) {
      // Ignore errors - this is intentional
      if (error.code && error.code !== 'EPIPE') {
        // Only log if it's not an expected error
      }
    }
    
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('resume-download', async (event, downloadId) => {
  const proc = downloadProcesses.get(downloadId);
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
      // Ignore errors - this is intentional
      if (error.code && error.code !== 'EPIPE') {
        // Only log if it's not an expected error
      }
    }
    
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('get-download-history', async () => {
  const db = await getDatabase();
  const history = db.prepare(`
    SELECT * FROM download_history 
    ORDER BY completed_at DESC 
    LIMIT 100
  `).all();
  
  return history.map(item => ({
    ...item,
    completedAt: item.completed_at,
    metadata: item.metadata ? JSON.parse(item.metadata) : {}
  }));
});

ipcMain.handle('clear-download-history', async () => {
  const db = await getDatabase();
  db.prepare('DELETE FROM download_history').run();
  return { success: true };
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
  const goBinary = findGoBinary();
  const args = ['--speedtest', '--test-type', testType];
  
  const proc = spawn(goBinary, args, {
    cwd: path.join(__dirname, '..'),
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
      console.error('Speed test error:', data.toString());
    } catch (logError) {
      // Ignore EPIPE errors
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
  };
}

