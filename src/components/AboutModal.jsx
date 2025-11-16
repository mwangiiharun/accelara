import { useState, useEffect } from 'react';
import { X, ExternalLink, Download, RefreshCw, CheckCircle, AlertCircle, Loader2, Folder } from 'lucide-react';

export default function AboutModal({ onClose }) {
  const [updateStatus, setUpdateStatus] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadPath, setDownloadPath] = useState(null);
  const [currentVersion] = useState('3.0.0'); // This should match package.json version
  
  // Listen for update-available events from background checks
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onUpdateAvailable) {
      const unlisten = window.electronAPI.onUpdateAvailable((data) => {
        setUpdateStatus({
          has_update: true,
          current_version: data.current_version,
          latest_version: data.latest_version,
          release_info: data.release_info,
          error: null,
        });
      });
      return () => {
        if (unlisten) unlisten();
      };
    }
  }, []);
  
  const libraries = [
    { name: 'anacrolix/torrent', url: 'https://github.com/anacrolix/torrent', description: 'BitTorrent client library' },
    { name: 'rusqlite', url: 'https://github.com/rusqlite/rusqlite', description: 'SQLite database' },
    { name: 'React', url: 'https://react.dev', description: 'UI framework' },
    { name: 'Tauri', url: 'https://tauri.app', description: 'Desktop framework' },
    { name: 'Vite', url: 'https://vitejs.dev', description: 'Build tool' },
    { name: 'Tailwind CSS', url: 'https://tailwindcss.com', description: 'Styling' },
    { name: 'Recharts', url: 'https://recharts.org', description: 'Charts' },
    { name: 'Axum', url: 'https://github.com/tokio-rs/axum', description: 'HTTP server framework' },
    { name: 'Tokio', url: 'https://tokio.rs', description: 'Async runtime' },
  ];

  async function handleCheckForUpdates() {
    if (!window.electronAPI) {
      alert('Update checking is not available');
      return;
    }
    
    setIsChecking(true);
    setUpdateStatus(null);
    
    try {
      const result = await window.electronAPI.checkForUpdates();
      setUpdateStatus(result);
    } catch (error) {
      console.error('Failed to check for updates:', error);
      setUpdateStatus({
        has_update: false,
        current_version: currentVersion,
        latest_version: currentVersion,
        release_info: null,
        error: error.message || String(error),
      });
    } finally {
      setIsChecking(false);
    }
  }
  
  async function handleDownloadUpdate() {
    if (!window.electronAPI || !updateStatus?.release_info) {
      return;
    }
    
    // Find the appropriate asset for the current platform
    const platform = navigator.platform.toLowerCase();
    let asset = null;
    
    if (platform.includes('mac')) {
      asset = updateStatus.release_info.assets.find(a => a.name.endsWith('.dmg'));
    } else if (platform.includes('win')) {
      asset = updateStatus.release_info.assets.find(a => a.name.endsWith('.msi') || a.name.endsWith('.exe'));
    } else {
      asset = updateStatus.release_info.assets.find(a => a.name.endsWith('.AppImage'));
    }
    
    if (!asset) {
      // Fallback to first asset
      asset = updateStatus.release_info.assets[0];
    }
    
    if (!asset) {
      alert('No update file found for your platform. Please download manually from GitHub.');
      return;
    }
    
    setIsDownloading(true);
    setDownloadProgress(0);
    
    try {
      // Simulate progress (actual progress would come from backend events)
      const progressInterval = setInterval(() => {
        setDownloadProgress(prev => Math.min(prev + 5, 95));
      }, 500);
      
      const path = await window.electronAPI.downloadUpdate(asset.browser_download_url, asset.name);
      
      clearInterval(progressInterval);
      setDownloadProgress(100);
      setDownloadPath(path);
      setIsDownloading(false);
      
      alert(`Update downloaded successfully!\n\nLocation: ${path}\n\nPlease install it manually.`);
    } catch (error) {
      console.error('Failed to download update:', error);
      alert(`Failed to download update: ${error.message || error}`);
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="theme-bg-secondary rounded-lg p-6 w-full max-w-2xl border theme-border max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-semibold theme-text-primary">About ACCELARA</h2>
          <button
            onClick={onClose}
            className="theme-text-secondary hover:theme-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 theme-text-secondary">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-lg">
                <span className="font-semibold theme-text-primary">ACCELARA</span> v{currentVersion}
              </p>
              <button
                onClick={handleCheckForUpdates}
                disabled={isChecking}
                className="px-3 py-1.5 text-sm theme-bg-tertiary theme-border border rounded-lg theme-text-secondary hover:theme-text-primary hover:theme-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                title="Check for updates"
              >
                {isChecking ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Checking...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>Check for Updates</span>
                  </>
                )}
              </button>
            </div>
            
            {updateStatus && (
              <div className={`mt-3 p-3 rounded-lg border ${
                updateStatus.has_update 
                  ? 'bg-green-500/10 border-green-500/30' 
                  : updateStatus.error
                  ? 'bg-red-500/10 border-red-500/30'
                  : 'bg-blue-500/10 border-blue-500/30'
              }`}>
                {updateStatus.has_update ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-400" />
                      <span className="text-sm font-medium theme-text-primary">
                        Update Available!
                      </span>
                    </div>
                    <p className="text-xs theme-text-secondary">
                      Version {updateStatus.latest_version} is available (you have {updateStatus.current_version})
                    </p>
                    {updateStatus.release_info && (
                      <div className="mt-2 space-y-1">
                        {updateStatus.release_info.body && (
                          <p className="text-xs theme-text-tertiary whitespace-pre-wrap">
                            {updateStatus.release_info.body.substring(0, 200)}
                            {updateStatus.release_info.body.length > 200 ? '...' : ''}
                          </p>
                        )}
                        <div className="flex gap-2 mt-2">
                          {!isDownloading && !downloadPath ? (
                            <>
                              <button
                                onClick={handleDownloadUpdate}
                                disabled={isDownloading}
                                className="px-3 py-1.5 text-xs theme-bg-primary text-white rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2 disabled:opacity-50"
                              >
                                <Download className="w-3 h-3" />
                                Download Update
                              </button>
                              <a
                                href={updateStatus.release_info.html_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-1.5 text-xs theme-bg-tertiary theme-border border rounded-lg theme-text-secondary hover:theme-text-primary transition-colors flex items-center gap-2"
                              >
                                <ExternalLink className="w-3 h-3" />
                                View Release
                              </a>
                            </>
                          ) : isDownloading ? (
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span className="text-xs theme-text-secondary">Downloading update...</span>
                              </div>
                              <div className="w-full theme-bg-secondary rounded-full h-2">
                                <div
                                  className="bg-primary-500 h-2 rounded-full transition-all"
                                  style={{ width: `${downloadProgress}%` }}
                                />
                              </div>
                            </div>
                          ) : downloadPath ? (
                            <div className="flex-1 space-y-2">
                              <div className="flex items-center gap-2 text-xs theme-text-secondary">
                                <CheckCircle className="w-3 h-3 text-green-400" />
                                <span>Downloaded to: {downloadPath}</span>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => {
                                    if (window.electronAPI) {
                                      window.electronAPI.openFolder(downloadPath);
                                    }
                                  }}
                                  className="px-3 py-1.5 text-xs theme-bg-tertiary theme-border border rounded-lg theme-text-secondary hover:theme-text-primary transition-colors flex items-center gap-2"
                                >
                                  <Folder className="w-3 h-3" />
                                  Open Folder
                                </button>
                                <a
                                  href={updateStatus.release_info.html_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-3 py-1.5 text-xs theme-bg-tertiary theme-border border rounded-lg theme-text-secondary hover:theme-text-primary transition-colors flex items-center gap-2"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  View Release
                                </a>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                ) : updateStatus.error ? (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <span className="text-xs theme-text-secondary">
                      Failed to check for updates: {updateStatus.error}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-blue-400" />
                    <span className="text-xs theme-text-secondary">
                      You're running the latest version ({updateStatus.current_version})
                    </span>
                  </div>
                )}
              </div>
            )}
            <p className="text-sm mb-2">
              High-performance unified HTTP + BitTorrent download manager
            </p>
            <p className="text-sm">
              Copyright © 2025 <span className="font-medium theme-text-primary">Mwangii Kinuthia</span>
            </p>
            <p className="text-xs theme-text-tertiary mt-2">
              Built with Tauri for native performance and smaller bundle size
            </p>
          </div>

          <div className="pt-4 border-t theme-border">
            <h3 className="text-lg font-semibold theme-text-primary mb-3">Open Source Libraries</h3>
            <p className="text-sm theme-text-tertiary mb-4">
              ACCELARA is built with the following open source libraries:
            </p>
            <div className="space-y-2">
              {libraries.map((lib) => (
                <div key={lib.name} className="flex items-start justify-between p-3 theme-bg-tertiary rounded-lg">
                  <div className="flex-1">
                    <a
                      href={lib.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-400 hover:text-primary-300 font-medium flex items-center gap-2"
                    >
                      {lib.name}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <p className="text-xs theme-text-tertiary mt-1">{lib.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t theme-border">
            <h3 className="text-lg font-semibold theme-text-primary mb-3">Features</h3>
            <ul className="text-sm theme-text-secondary space-y-1 list-disc list-inside">
              <li>HTTP/HTTPS downloads with chunked downloading and resume support</li>
              <li>BitTorrent and Magnet link support</li>
              <li>Browser extension integration (Chrome & Firefox)</li>
              <li>Speed test functionality</li>
              <li>Download history and statistics</li>
              <li>System theme detection</li>
              <li>Background/daemon mode</li>
            </ul>
          </div>

          <div className="pt-4 border-t theme-border">
            <p className="text-sm theme-text-tertiary">
              ACCELARA is open source software. Contributions and feedback are welcome.
            </p>
          </div>
        </div>

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="btn-primary px-6"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
