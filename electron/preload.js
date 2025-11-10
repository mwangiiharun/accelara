const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startDownload: (config) => ipcRenderer.invoke('start-download', config),
  stopDownload: (downloadId) => ipcRenderer.invoke('stop-download', downloadId),
  pauseDownload: (downloadId) => ipcRenderer.invoke('pause-download', downloadId),
  resumeDownload: (downloadId) => ipcRenderer.invoke('resume-download', downloadId),
  getDownloadHistory: () => ipcRenderer.invoke('get-download-history'),
  clearDownloadHistory: () => ipcRenderer.invoke('clear-download-history'),
  inspectTorrent: (source) => ipcRenderer.invoke('inspect-torrent', source),
  getHTTPInfo: (source) => ipcRenderer.invoke('get-http-info', source),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  
  onDownloadUpdate: (callback) => {
    ipcRenderer.on('download-update', (event, data) => callback(data));
  },
  onDownloadComplete: (callback) => {
    ipcRenderer.on('download-complete', (event, data) => callback(data));
  },
  onExternalDownload: (callback) => {
    ipcRenderer.on('external-download', (event, data) => callback(data));
  },
  removeListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
  
  selectTorrentFile: () => ipcRenderer.invoke('select-torrent-file'),
  selectDownloadFolder: () => ipcRenderer.invoke('select-download-folder'),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  
  getSystemTheme: () => ipcRenderer.invoke('get-system-theme'),
  onSystemThemeChange: (callback) => {
    ipcRenderer.on('system-theme-changed', (event, theme) => callback(theme));
  },
  
  saveSpeedTestResult: (result) => ipcRenderer.invoke('save-speed-test-result', result),
  getSpeedTestResults: (limit) => ipcRenderer.invoke('get-speed-test-results', limit),
  clearSpeedTestResults: () => ipcRenderer.invoke('clear-speed-test-results'),
  startSpeedTest: (testType) => ipcRenderer.invoke('start-speed-test', { testType }),
  stopSpeedTest: (testId) => ipcRenderer.invoke('stop-speed-test', testId),
  onSpeedTestUpdate: (callback) => {
    ipcRenderer.on('speed-test-update', (event, data) => callback(data));
  },
  onSpeedTestComplete: (callback) => {
    ipcRenderer.on('speed-test-complete', (event, data) => callback(data));
  },
  onSpeedTestError: (callback) => {
    ipcRenderer.on('speed-test-error', (event, data) => callback(data));
  },
  removeSpeedTestListeners: () => {
    ipcRenderer.removeAllListeners('speed-test-update');
    ipcRenderer.removeAllListeners('speed-test-complete');
    ipcRenderer.removeAllListeners('speed-test-error');
  },
});

