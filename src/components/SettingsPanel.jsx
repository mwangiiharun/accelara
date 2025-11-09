import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { Sun, Monitor, Sparkles, Folder, Check } from 'lucide-react';

export default function SettingsPanel() {
  const { settings, updateSettings } = useSettings();
  const [applyFeedback, setApplyFeedback] = useState(false);
  
  // Local state for text inputs that require Apply button
  const [localSettings, setLocalSettings] = useState({
    defaultDownloadPath: '',
    chunkSize: '4MB',
    rateLimit: null,
    uploadLimit: null,
    connectTimeout: 15,
    readTimeout: 60,
    retries: 5,
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
    });
  }, [settings]);

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
    </div>
  );
}
