// Check if we're running in Tauri
const isTauriAvailable = () => {
  return typeof window !== 'undefined' && 
         (window.__TAURI_INTERNALS__ !== undefined || 
          window.__TAURI__ !== undefined ||
          (window.navigator && window.navigator.userAgent.includes('Tauri')));
};

// Lazy load Tauri APIs to handle cases where Tauri isn't ready yet
let invokeFn = null;
let listenFn = null;
let tauriAvailable = isTauriAvailable();

// Re-check Tauri availability periodically (in case it loads after our script)
if (!tauriAvailable) {
  // Check again after a short delay
  setTimeout(() => {
    tauriAvailable = isTauriAvailable();
    if (tauriAvailable) {
      console.log('Tauri API detected');
    }
  }, 100);
}

const getInvoke = async () => {
  if (!tauriAvailable) {
    throw new Error('Tauri API not available. Make sure the app is running in Tauri (not a regular browser).');
  }
  
  if (!invokeFn) {
    try {
      const core = await import('@tauri-apps/api/core');
      invokeFn = core.invoke;
    } catch (e) {
      console.error('Failed to load Tauri core API:', e);
      throw new Error('Tauri API not available. Make sure the app is running in Tauri.');
    }
  }
  return invokeFn;
};

const getListen = async () => {
  if (!tauriAvailable) {
    throw new Error('Tauri API not available. Make sure the app is running in Tauri (not a regular browser).');
  }
  
  if (!listenFn) {
    try {
      const event = await import('@tauri-apps/api/event');
      listenFn = event.listen;
    } catch (e) {
      console.error('Failed to load Tauri event API:', e);
      throw new Error('Tauri API not available. Make sure the app is running in Tauri.');
    }
  }
  return listenFn;
};

// Wrapper functions with availability check
const invoke = async (...args) => {
  if (!tauriAvailable) {
    tauriAvailable = isTauriAvailable(); // Re-check
    if (!tauriAvailable) {
      throw new Error('Tauri API not available. Please run the app using: npm run dev:tauri');
    }
  }
  const fn = await getInvoke();
  return await fn(...args);
};

const listen = async (...args) => {
  if (!tauriAvailable) {
    tauriAvailable = isTauriAvailable(); // Re-check
    if (!tauriAvailable) {
      throw new Error('Tauri API not available. Please run the app using: npm run dev:tauri');
    }
  }
  const fn = await getListen();
  return await fn(...args);
};

/**
 * Tauri API wrapper that mimics the Electron API interface
 * This allows us to gradually migrate from Electron to Tauri
 */
export const tauriAPI = {
  // Store unlisten functions
  _unlistenFunctions: {},

  // Download operations
  async startDownload(config) {
    const downloadId = await invoke('start_download', { config });
    return { downloadId };
  },

  async stopDownload(downloadId) {
    await invoke('stop_download', { downloadId });
    return { success: true };
  },

  async pauseDownload(downloadId) {
    await invoke('pause_download', { downloadId });
    return { success: true };
  },

  async resumeDownload(downloadId) {
    await invoke('resume_download', { downloadId });
    return { success: true };
  },

  async removeDownload(downloadId) {
    await invoke('remove_download', { downloadId });
    return { success: true };
  },

  async getActiveDownloads() {
    return await invoke('get_active_downloads');
  },

  async getDownloadHistory() {
    return await invoke('get_download_history');
  },

  async clearDownloadHistory() {
    await invoke('clear_download_history');
    return { success: true };
  },

  async inspectTorrent(source) {
    return await invoke('inspect_torrent', { source });
  },

  async getHTTPInfo(source) {
    return await invoke('get_http_info', { source });
  },

  // Settings
  async getSettings() {
    return await invoke('get_settings');
  },

  async saveSettings(settings) {
    await invoke('save_settings', { settings });
    return { success: true };
  },

  // File operations
  async selectTorrentFile() {
    return await invoke('select_torrent_file');
  },

  async selectDownloadFolder() {
    return await invoke('select_download_folder');
  },

  async openFolder(folderPath) {
    await invoke('open_folder', { folderPath });
    return { success: true };
  },

  // System
  async getSystemTheme() {
    return await invoke('get_system_theme');
  },

  async showWindow() {
    return await invoke('show_window');
  },

  async quitApp() {
    return await invoke('quit_app');
  },

  // Debug/Logging
  async getLogPath() {
    return await invoke('get_log_path');
  },

  async getRecentLogs(lines) {
    return await invoke('get_recent_logs', { lines });
  },

  async openDebugLogWindow() {
    return await invoke('open_debug_log_window');
  },

  async checkForUpdates() {
    return await invoke('check_for_updates');
  },

  async downloadUpdate(assetUrl, filename) {
    return await invoke('download_update', { assetUrl, filename });
  },

  onUpdateAvailable(callback) {
    const key = 'update-available';
    listen('update-available', (event) => {
      callback(event.payload);
    }).then((unlisten) => {
      this._unlistenFunctions[key] = unlisten;
    }).catch((err) => {
      console.error('Failed to set up update-available listener:', err);
    });
    return () => {
      if (this._unlistenFunctions[key]) {
        this._unlistenFunctions[key]();
        delete this._unlistenFunctions[key];
      }
    };
  },

  // Speed test
  async saveSpeedTestResult(result) {
    const testId = await invoke('save_speed_test_result', { result });
    return { success: true, testId };
  },

  async getSpeedTestResults(limit) {
    return await invoke('get_speed_test_results', { limit });
  },

  async clearSpeedTestResults() {
    await invoke('clear_speed_test_results');
    return { success: true };
  },

  async startSpeedTest(testType = 'full') {
    return await invoke('start_speed_test', { testType });
  },

  async stopSpeedTest(testId) {
    await invoke('stop_speed_test', { testId });
    return { success: true };
  },

  // Junk data
  async getJunkDataSize() {
    return await invoke('get_junk_data_size');
  },

  async clearJunkData() {
    return await invoke('clear_junk_data');
  },

  // Event listeners
  onDownloadUpdate(callback) {
    const key = 'download-update';
    listen('download-update', (event) => {
      callback(event.payload);
    }).then((unlisten) => {
      this._unlistenFunctions[key] = unlisten;
    }).catch((err) => {
      console.error('Failed to set up download-update listener:', err);
    });
    // Return cleanup function
    return () => {
      if (this._unlistenFunctions[key]) {
        this._unlistenFunctions[key]();
        delete this._unlistenFunctions[key];
      }
    };
  },

  onDownloadComplete(callback) {
    const key = 'download-complete';
    listen('download-complete', (event) => {
      callback(event.payload);
    }).then((unlisten) => {
      this._unlistenFunctions[key] = unlisten;
    }).catch((err) => {
      console.error('Failed to set up download-complete listener:', err);
    });
    return () => {
      if (this._unlistenFunctions[key]) {
        this._unlistenFunctions[key]();
        delete this._unlistenFunctions[key];
      }
    };
  },

  onExternalDownload(callback) {
    const key = 'external-download';
    listen('external-download', (event) => {
      callback(event.payload);
    }).then((unlisten) => {
      this._unlistenFunctions[key] = unlisten;
    }).catch((err) => {
      console.error('Failed to set up external-download listener:', err);
    });
    return () => {
      if (this._unlistenFunctions[key]) {
        this._unlistenFunctions[key]();
        delete this._unlistenFunctions[key];
      }
    };
  },

  onSpeedTestUpdate(callback) {
    const key = 'speed-test-update';
    listen('speed-test-update', (event) => {
      callback(event.payload);
    }).then((unlisten) => {
      this._unlistenFunctions[key] = unlisten;
    }).catch((err) => {
      console.error('Failed to set up speed-test-update listener:', err);
    });
    return () => {
      if (this._unlistenFunctions[key]) {
        this._unlistenFunctions[key]();
        delete this._unlistenFunctions[key];
      }
    };
  },

  onSpeedTestComplete(callback) {
    const key = 'speed-test-complete';
    listen('speed-test-complete', (event) => {
      callback(event.payload);
    }).then((unlisten) => {
      this._unlistenFunctions[key] = unlisten;
    }).catch((err) => {
      console.error('Failed to set up speed-test-complete listener:', err);
    });
    return () => {
      if (this._unlistenFunctions[key]) {
        this._unlistenFunctions[key]();
        delete this._unlistenFunctions[key];
      }
    };
  },

  onSpeedTestError(callback) {
    const key = 'speed-test-error';
    listen('speed-test-error', (event) => {
      callback(event.payload);
    }).then((unlisten) => {
      this._unlistenFunctions[key] = unlisten;
    }).catch((err) => {
      console.error('Failed to set up speed-test-error listener:', err);
    });
    return () => {
      if (this._unlistenFunctions[key]) {
        this._unlistenFunctions[key]();
        delete this._unlistenFunctions[key];
      }
    };
  },

  onSystemThemeChange(callback) {
    const key = 'system-theme-changed';
    let unlistenFn = null;
    listen('system-theme-changed', (event) => {
      callback(event.payload);
    }).then((unlisten) => {
      unlistenFn = unlisten;
      this._unlistenFunctions[key] = unlisten;
    }).catch((err) => {
      console.error('Failed to set up system-theme-changed listener:', err);
    });
    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
      if (this._unlistenFunctions[key]) {
        this._unlistenFunctions[key]();
        delete this._unlistenFunctions[key];
      }
    };
  },

  removeListeners(channel) {
    // Clean up listeners by channel
    const keys = Object.keys(this._unlistenFunctions).filter(k => k === channel);
    keys.forEach(key => {
      if (this._unlistenFunctions[key]) {
        this._unlistenFunctions[key]();
        delete this._unlistenFunctions[key];
      }
    });
  },

  removeSpeedTestListeners() {
    this.removeListeners('speed-test-update');
    this.removeListeners('speed-test-complete');
    this.removeListeners('speed-test-error');
  },

  // Window operations
  async focusWindow() {
    // Tauri doesn't need explicit focus window - handled by OS
    return { success: true };
  },
};

// Make it available globally for compatibility
if (typeof window !== 'undefined') {
  window.electronAPI = tauriAPI;
  window.tauriAPI = tauriAPI;
}
