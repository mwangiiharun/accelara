import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { Sun, Monitor, Sparkles, Folder, Check, Trash2, Loader2, Power, Bug, RefreshCw, Bell } from 'lucide-react';

export default function SettingsPanel() {
  const { settings, updateSettings } = useSettings();
  const [applyFeedback, setApplyFeedback] = useState(false);
  const [junkDataSize, setJunkDataSize] = useState(null);
  const [isLoadingJunk, setIsLoadingJunk] = useState(false);
  const [isClearingJunk, setIsClearingJunk] = useState(false);
  
  // Local state for text inputs that require Apply button
  const [localSettings, setLocalSettings] = useState({
    defaultDownloadPath: '',
    chunkSize: '4MB',
    rateLimit: null,
    uploadLimit: null,
    connectTimeout: 15,
    readTimeout: 60,
    retries: 5,
    torrentPort: 42069,
  });
  
  // Initialize local settings from loaded settings
  useEffect(() => {
    setLocalSettings({
      defaultDownloadPath: settings.defaultDownloadPath || '',
      chunkSize: settings.chunkSize || '4MB',
      rateLimit: settings.rateLimit || null,
      uploadLimit: settings.uploadLimit || null,
      connectTimeout: settings.connectTimeout || 15,
      readTimeout: settings.readTimeout || 60,
      retries: settings.retries || 5,
      torrentPort: settings.torrentPort || 42069,
    });
    
    // Load junk data size on mount
    loadJunkDataSize();
  }, [settings]);
  
  const loadJunkDataSize = async () => {
    if (window.electronAPI) {
      setIsLoadingJunk(true);
      try {
        const result = await window.electronAPI.getJunkDataSize();
        setJunkDataSize(result);
      } catch (error) {
        console.error('Failed to load junk data size:', error);
      } finally {
        setIsLoadingJunk(false);
      }
    }
  };
  
  const handleClearJunkData = async () => {
    if (!window.electronAPI || !confirm(`Are you sure you want to delete all junk data? This will remove ${junkDataSize?.sizeFormatted || 'unknown amount'} of partial download files.`)) {
      return;
    }
    
    setIsClearingJunk(true);
    try {
      const result = await window.electronAPI.clearJunkData();
      if (result.success) {
        alert(`Successfully deleted ${result.deletedSizeFormatted} of junk data (${result.deletedCount} items)`);
        // Reload junk data size
        await loadJunkDataSize();
      } else {
        alert(`Failed to clear junk data: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to clear junk data:', error);
      alert('Failed to clear junk data');
    } finally {
      setIsClearingJunk(false);
    }
  };

  // Auto-save for theme and concurrency
  const handleAutoSaveChange = (key, value) => {
    updateSettings({ [key]: value });
  };
  
  // Local change for text inputs (requires Apply)
  const handleLocalChange = (key, value) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }));
  };
  
  // Apply button handler - saves all local settings
  const handleApply = async () => {
    await updateSettings(localSettings);
    setApplyFeedback(true);
    setTimeout(() => {
      setApplyFeedback(false);
    }, 2000);
  };

  return (
    <div className="p-4 space-y-6">
      <h3 className="text-lg font-semibold theme-text-primary">Settings</h3>

      {/* Default Download Path */}
      <div>
        <label className="block text-sm font-medium theme-text-secondary mb-2">
          Default Download Location
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={localSettings.defaultDownloadPath}
            onChange={(e) => handleLocalChange('defaultDownloadPath', e.target.value)}
            className="input-field flex-1"
            placeholder="~/Downloads"
          />
          <button
            onClick={async () => {
              if (window.electronAPI) {
                try {
                  const folderPath = await window.electronAPI.selectDownloadFolder();
                  if (folderPath) {
                    handleLocalChange('defaultDownloadPath', folderPath);
                  }
                } catch (error) {
                  console.error('Failed to select download folder:', error);
                }
              }
            }}
            className="btn-secondary px-4 flex items-center gap-2"
            title="Select default download folder"
          >
            <Folder className="w-4 h-4" />
            Browse
          </button>
        </div>
      </div>

      {/* Theme */}
      <div>
        <label className="block text-sm font-medium theme-text-secondary mb-2">
          Theme
        </label>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => handleAutoSaveChange('theme', 'system')}
            className={`px-4 py-2 rounded-lg flex flex-col items-center justify-center gap-1 transition-colors ${
              settings.theme === 'system' 
                ? 'bg-primary-600 text-white' 
                : 'theme-bg-secondary theme-text-secondary hover:theme-bg-hover'
            }`}
          >
            <Monitor className="w-4 h-4" />
            <span className="text-xs">System</span>
          </button>
          <button
            onClick={() => handleAutoSaveChange('theme', 'light')}
            className={`px-4 py-2 rounded-lg flex flex-col items-center justify-center gap-1 transition-colors ${
              settings.theme === 'light' 
                ? 'bg-primary-600 text-white' 
                : 'theme-bg-secondary theme-text-secondary hover:theme-bg-hover'
            }`}
          >
            <Sun className="w-4 h-4" />
            <span className="text-xs">Light</span>
          </button>
          <button
            onClick={() => handleAutoSaveChange('theme', 'cyan')}
            className={`px-4 py-2 rounded-lg flex flex-col items-center justify-center gap-1 transition-colors ${
              settings.theme === 'cyan' 
                ? 'bg-primary-600 text-white' 
                : 'theme-bg-secondary theme-text-secondary hover:theme-bg-hover'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span className="text-xs">Cyan</span>
          </button>
        </div>
      </div>

      {/* Concurrency / Max Chunks */}
      <div>
        <label className="block text-sm font-medium theme-text-secondary mb-2">
          Max Concurrent Chunks ({settings.concurrency || 8})
        </label>
        <input
          type="range"
          min="1"
          max="8"
          value={settings.concurrency || 8}
          onChange={(e) => handleAutoSaveChange('concurrency', parseInt(e.target.value))}
          className="w-full"
        />
        <p className="text-xs theme-text-tertiary mt-1">
          Number of parallel chunks for HTTP downloads (1-8)
        </p>
      </div>

      {/* Chunk Size */}
      <div>
        <label className="block text-sm font-medium theme-text-secondary mb-2">
          Chunk Size
        </label>
        <input
          type="text"
          value={localSettings.chunkSize}
          onChange={(e) => handleLocalChange('chunkSize', e.target.value)}
          className="input-field w-full"
          placeholder="4MB"
        />
      </div>

      {/* Rate Limit */}
      <div>
        <label className="block text-sm font-medium theme-text-secondary mb-2">
          Download Rate Limit (optional)
        </label>
        <input
          type="text"
          value={localSettings.rateLimit || ''}
          onChange={(e) => handleLocalChange('rateLimit', e.target.value || null)}
          className="input-field w-full"
          placeholder="e.g., 10MB"
        />
      </div>

      {/* Upload Limit */}
      <div>
        <label className="block text-sm font-medium theme-text-secondary mb-2">
          Upload Rate Limit (optional)
        </label>
        <input
          type="text"
          value={localSettings.uploadLimit || ''}
          onChange={(e) => handleLocalChange('uploadLimit', e.target.value || null)}
          className="input-field w-full"
          placeholder="e.g., 2MB"
        />
      </div>

      {/* Sequential Mode */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.sequentialMode}
            onChange={(e) => handleAutoSaveChange('sequentialMode', e.target.checked)}
            className="w-4 h-4 rounded theme-bg-tertiary theme-border text-primary-600 focus:ring-primary-500"
          />
          <span className="text-sm theme-text-secondary">Sequential Mode (for streaming)</span>
        </label>
      </div>

      {/* Keep Seeding */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.keepSeeding || false}
            onChange={(e) => handleAutoSaveChange('keepSeeding', e.target.checked)}
            className="w-4 h-4 rounded theme-bg-tertiary theme-border text-primary-600 focus:ring-primary-500"
          />
          <span className="text-sm theme-text-secondary">Keep Seeding (for torrents)</span>
        </label>
        <p className="text-xs theme-text-tertiary mt-1 ml-6">
          Continue seeding torrents after download completes
        </p>
      </div>

      {/* Timeouts */}
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium theme-text-secondary mb-2">
            Connect Timeout (seconds)
          </label>
          <input
            type="number"
            value={localSettings.connectTimeout}
            onChange={(e) => handleLocalChange('connectTimeout', parseInt(e.target.value) || 15)}
            className="input-field w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium theme-text-secondary mb-2">
            Read Timeout (seconds)
          </label>
          <input
            type="number"
            value={localSettings.readTimeout}
            onChange={(e) => handleLocalChange('readTimeout', parseInt(e.target.value) || 60)}
            className="input-field w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium theme-text-secondary mb-2">
            Retries
          </label>
          <input
            type="number"
            value={localSettings.retries}
            onChange={(e) => handleLocalChange('retries', parseInt(e.target.value) || 5)}
            className="input-field w-full"
          />
        </div>
      </div>

      {/* BitTorrent Settings */}
      <div>
        <label className="block text-sm font-medium theme-text-secondary mb-2">
          BitTorrent Port
        </label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={localSettings.torrentPort}
            onChange={(e) => handleLocalChange('torrentPort', parseInt(e.target.value) || 42069)}
            className="input-field flex-1"
            min="1024"
            max="65535"
            placeholder="42069"
          />
          <span className="text-xs theme-text-tertiary whitespace-nowrap">
            Default: 42069
          </span>
        </div>
        <p className="text-xs theme-text-tertiary mt-1">
          Port for BitTorrent connections. If unavailable, will try next 4 ports automatically.
        </p>
      </div>
      
      {/* Apply Button for Text Inputs */}
      <div className="pt-4 border-t theme-border">
        <button
          onClick={handleApply}
          disabled={applyFeedback}
          className={`btn-primary w-full flex items-center justify-center gap-2 ${
            applyFeedback ? 'opacity-75 cursor-not-allowed' : ''
          }`}
          type="button"
        >
          <Check className="w-4 h-4" />
          {applyFeedback ? 'Applied!' : 'Apply Settings'}
        </button>
        <p className="text-xs theme-text-tertiary mt-2 text-center">
          Theme and concurrency auto-save. Other settings require Apply.
        </p>
      </div>
      
      {/* Clear Junk Data */}
      <div className="pt-4 border-t theme-border">
        <div className="mb-3">
          <h3 className="text-sm font-medium theme-text-primary mb-2">Storage Cleanup</h3>
          <p className="text-xs theme-text-tertiary mb-3">
            Remove partial download files and temporary data accumulated from incomplete downloads.
          </p>
          {isLoadingJunk ? (
            <div className="flex items-center gap-2 text-sm theme-text-secondary">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Calculating junk data size...</span>
            </div>
          ) : junkDataSize ? (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm theme-text-secondary">Junk Data Found:</span>
                <span className="text-sm font-medium theme-text-primary">
                  {junkDataSize.sizeFormatted}
                </span>
              </div>
              {junkDataSize.paths > 0 && (
                <p className="text-xs theme-text-tertiary">
                  {junkDataSize.paths} temporary {junkDataSize.paths === 1 ? 'directory' : 'directories'} found
                </p>
              )}
            </div>
          ) : null}
          <button
            onClick={handleClearJunkData}
            disabled={isClearingJunk || isLoadingJunk || !junkDataSize || junkDataSize.size === 0}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              isClearingJunk || isLoadingJunk || !junkDataSize || junkDataSize.size === 0
                ? 'bg-gray-500/20 text-gray-500 cursor-not-allowed'
                : 'bg-red-500/20 hover:bg-red-500/30 text-red-500 dark:text-red-400'
            }`}
            type="button"
          >
            {isClearingJunk ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Clearing...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                <span>Clear Junk Data</span>
              </>
            )}
          </button>
          {junkDataSize && junkDataSize.size === 0 && (
            <p className="text-xs theme-text-tertiary mt-2 text-center">
              No junk data found
            </p>
          )}
        </div>
      </div>

      {/* Update Settings */}
      <div className="pt-4 border-t theme-border">
        <h4 className="text-sm font-semibold theme-text-primary mb-3 flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Update Settings
        </h4>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-medium theme-text-secondary">
                Auto-check for updates
              </label>
              <p className="text-xs theme-text-tertiary mt-1">
                Automatically check for updates on startup and periodically
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoCheckForUpdates !== false}
                onChange={(e) => handleAutoSaveChange('autoCheckForUpdates', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 theme-bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
            </label>
          </div>
          
          {settings.autoCheckForUpdates !== false && (
            <div>
              <label className="block text-sm font-medium theme-text-secondary mb-2">
                Check interval (hours)
              </label>
              <input
                type="number"
                min="1"
                max="168"
                value={settings.updateCheckInterval || 24}
                onChange={(e) => handleAutoSaveChange('updateCheckInterval', parseInt(e.target.value) || 24)}
                className="input-field w-full"
              />
              <p className="text-xs theme-text-tertiary mt-1">
                How often to check for updates (1-168 hours)
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Debug Logs */}
      <div className="pt-4 border-t theme-border">
        <button
          onClick={async () => {
            if (window.electronAPI && window.electronAPI.openDebugLogWindow) {
              try {
                await window.electronAPI.openDebugLogWindow();
              } catch (error) {
                console.error('Failed to open debug log window:', error);
                alert('Failed to open debug log window. Make sure you are running in Tauri.');
              }
            } else {
              alert('Debug log window feature not available. Make sure you are running in Tauri.');
            }
          }}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors theme-bg-tertiary hover:theme-bg-primary theme-text-secondary hover:theme-text-primary"
          type="button"
        >
          <Bug className="w-4 h-4" />
          <span>View Debug Logs</span>
        </button>
        <p className="text-xs theme-text-tertiary mt-2 text-center">
          Opens in a separate window that can be moved outside the main window
        </p>
      </div>

      {/* Quit App */}
      <div className="pt-4 border-t theme-border">
        <button
          onClick={async () => {
            if (window.electronAPI && confirm('Are you sure you want to quit ACCELARA? All active downloads will be paused.')) {
              try {
                await window.electronAPI.quitApp();
              } catch (error) {
                console.error('Failed to quit app:', error);
              }
            }
          }}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors bg-red-500/20 hover:bg-red-500/30 text-red-500 dark:text-red-400"
          type="button"
        >
          <Power className="w-4 h-4" />
          <span>Quit ACCELARA</span>
        </button>
        <p className="text-xs theme-text-tertiary mt-2 text-center">
          Note: Closing the window keeps the app running in the background. Use this button to fully quit.
        </p>
      </div>
    </div>
  );
}
