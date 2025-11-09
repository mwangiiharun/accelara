import { useState, useEffect } from 'react';
import { useDownloads } from '../context/DownloadContext';
import { useSettings } from '../context/SettingsContext';
import { X, File, Folder, Loader2, AlertCircle } from 'lucide-react';
import { formatBytes } from '../utils/format';

export default function AddDownloadModal({ onClose }) {
  const { startDownload } = useDownloads();
  const { settings } = useSettings();
  const [source, setSource] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [torrentInfo, setTorrentInfo] = useState(null);
  const [httpInfo, setHttpInfo] = useState(null);
  const [inspectError, setInspectError] = useState(null);

  useEffect(() => {
    // Set default download path from settings
    if (settings.defaultDownloadPath && !output) {
      setOutput(settings.defaultDownloadPath);
    }
  }, [settings.defaultDownloadPath]);

  // Inspect source when it changes
  useEffect(() => {
    if (!source || !window.electronAPI) return;

    const inspectSource = async () => {
      setInspecting(true);
      setInspectError(null);
      setTorrentInfo(null);
      setHttpInfo(null);

      try {
        // Check if it's a torrent
        const isTorrent = source.startsWith('magnet:') || 
                         source.endsWith('.torrent') || 
                         (source.includes('.torrent') && !source.includes('?'));

        if (isTorrent) {
          if (source.startsWith('magnet:')) {
            // For magnet links, we can't inspect without downloading metadata
            setInspectError('Magnet links require metadata download. Details will be shown after starting.');
          } else {
            const info = await window.electronAPI.inspectTorrent(source);
            setTorrentInfo(info);
            // Auto-set output filename if not set
            if (!output && info.name) {
              const defaultPath = settings.defaultDownloadPath || require('os').homedir() + '/Downloads';
              setOutput(defaultPath);
            }
          }
        } else if (source.startsWith('http://') || source.startsWith('https://')) {
          // Get HTTP file info
          const info = await window.electronAPI.getHTTPInfo(source);
          setHttpInfo(info);
          // Auto-set output filename if not set
          if (!output && info.fileName) {
            const defaultPath = settings.defaultDownloadPath || require('os').homedir() + '/Downloads';
            setOutput(defaultPath + '/' + info.fileName);
          }
        }
      } catch (error) {
        console.error('Failed to inspect source:', error);
        setInspectError(error.message);
      } finally {
        setInspecting(false);
      }
    };

    // Debounce inspection
    const timeoutId = setTimeout(inspectSource, 500);
    return () => clearTimeout(timeoutId);
  }, [source, settings.defaultDownloadPath]);

  const handleSelectTorrent = async () => {
    if (window.electronAPI) {
      try {
        const filePath = await window.electronAPI.selectTorrentFile();
        if (filePath) {
          setSource(filePath);
        }
      } catch (error) {
        console.error('Failed to select torrent file:', error);
      }
    }
  };

  const handleSelectFolder = async () => {
    if (window.electronAPI) {
      try {
        const folderPath = await window.electronAPI.selectDownloadFolder();
        if (folderPath) {
          setOutput(folderPath);
        }
      } catch (error) {
        console.error('Failed to select download folder:', error);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      await startDownload(source, output || undefined, {
        concurrency: settings.concurrency,
        chunk_size: settings.chunkSize,
        limit: settings.rateLimit,
        bt_upload_limit: settings.uploadLimit,
        bt_sequential: settings.sequentialMode,
        bt_keep_seeding: settings.keepSeeding || false,
        connect_timeout: settings.connectTimeout,
        read_timeout: settings.readTimeout,
        retries: settings.retries,
      });
      onClose();
    } catch (error) {
      console.error('Failed to start download:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="theme-bg-secondary rounded-lg p-6 w-full max-w-md border theme-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold theme-text-primary">New Download</h2>
          <button
            onClick={onClose}
            className="theme-text-secondary hover:theme-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium theme-text-secondary mb-2">
              Source (URL, Magnet, or .torrent file)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="input-field flex-1"
                placeholder="https://example.com/file.zip or magnet:?..."
                required
              />
              <button
                type="button"
                onClick={handleSelectTorrent}
                className="btn-secondary px-4 flex items-center gap-2"
                title="Select .torrent file"
              >
                <File className="w-4 h-4" />
                Browse
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium theme-text-secondary mb-2">
              Download Location
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={output}
                onChange={(e) => setOutput(e.target.value)}
                className="input-field flex-1"
                placeholder={settings.defaultDownloadPath || "~/Downloads"}
              />
              <button
                type="button"
                onClick={handleSelectFolder}
                className="btn-secondary px-4 flex items-center gap-2"
                title="Select download folder"
              >
                <Folder className="w-4 h-4" />
                Browse
              </button>
            </div>
          </div>

          {/* Torrent Info Preview */}
          {inspecting && (
            <div className="flex items-center gap-2 text-sm theme-text-secondary">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Inspecting source...</span>
            </div>
          )}

          {inspectError && (
            <div className="flex items-start gap-2 p-3 theme-bg-tertiary rounded-lg border theme-border">
              <AlertCircle className="w-4 h-4 theme-text-tertiary flex-shrink-0 mt-0.5" />
              <p className="text-sm theme-text-tertiary">{inspectError}</p>
            </div>
          )}

          {torrentInfo && (
            <div className="p-4 theme-bg-tertiary rounded-lg border theme-border">
              <h3 className="text-sm font-semibold theme-text-primary mb-2">Torrent Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="theme-text-secondary">Name:</span>
                  <span className="theme-text-primary font-medium">{torrentInfo.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="theme-text-secondary">Total Size:</span>
                  <span className="theme-text-primary font-medium">{formatBytes(torrentInfo.totalSize)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="theme-text-secondary">Files:</span>
                  <span className="theme-text-primary font-medium">{torrentInfo.fileCount}</span>
                </div>
                {torrentInfo.files && torrentInfo.files.length > 0 && torrentInfo.files.length <= 10 && (
                  <div className="mt-3 pt-3 border-t theme-border">
                    <p className="text-xs theme-text-secondary mb-2">File List:</p>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {torrentInfo.files.map((file, idx) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="theme-text-tertiary truncate flex-1 mr-2">{file.path}</span>
                          <span className="theme-text-secondary flex-shrink-0">{formatBytes(file.size)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {torrentInfo.files && torrentInfo.files.length > 10 && (
                  <div className="mt-3 pt-3 border-t theme-border">
                    <p className="text-xs theme-text-secondary">
                      {torrentInfo.files.length} files (showing first 10)
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* HTTP Info Preview */}
          {httpInfo && (
            <div className="p-4 theme-bg-tertiary rounded-lg border theme-border">
              <h3 className="text-sm font-semibold theme-text-primary mb-2">File Information</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="theme-text-secondary">Filename:</span>
                  <span className="theme-text-primary font-medium truncate ml-2">{httpInfo.fileName}</span>
                </div>
                {httpInfo.totalSize > 0 && (
                  <div className="flex justify-between">
                    <span className="theme-text-secondary">Size:</span>
                    <span className="theme-text-primary font-medium">{formatBytes(httpInfo.totalSize)}</span>
                  </div>
                )}
                {httpInfo.contentType && (
                  <div className="flex justify-between">
                    <span className="theme-text-secondary">Type:</span>
                    <span className="theme-text-primary font-medium">{httpInfo.contentType}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={loading}
            >
              {loading ? 'Starting...' : 'Start Download'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

