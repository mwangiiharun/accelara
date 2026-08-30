import { useState, useEffect } from 'react';
import { useDownloads } from '../context/DownloadContext';
import { useSettings } from '../context/SettingsContext';
import { X, File, Folder, Loader2, AlertCircle, Tv, Clapperboard, Package } from 'lucide-react';
import { formatBytes } from '../utils/format';
import { detectMediaType, buildLibraryPath } from '../utils/mediaDetect';

export default function AddDownloadModal({ onClose, initialSource = '', autoStart = false }) {
  const { startDownload, resumeDownload } = useDownloads();
  const { settings } = useSettings();
  const [source, setSource] = useState(initialSource);
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [torrentInfo, setTorrentInfo] = useState(null);
  const [httpInfo, setHttpInfo] = useState(null);
  const [inspectError, setInspectError] = useState(null);
  const [downloadId, setDownloadId] = useState(null);
  const [detected, setDetected] = useState(null); // { type: 'tv'|'movie'|'software'|'unknown', title, year, season, episode }
  const [mediaChoice, setMediaChoice] = useState(null); // manual override: 'tv' | 'movie' | 'software' | 'other' | null
  const [pickerOpen, setPickerOpen] = useState(false); // user asked to re-pick via "Not right?"
  const [sourceNameInfo, setSourceNameInfo] = useState(null); // { rawName, isHttp }

  const applyDetectedOutput = (detectedResult, choice, nameInfo = sourceNameInfo) => {
    const defaultPath = settings.defaultDownloadPath || (typeof require !== 'undefined' ? require('os').homedir() + '/Downloads' : '~/Downloads');
    const effectiveType = choice === 'other' ? 'unknown' : (choice || detectedResult.type);
    const path = buildLibraryPath(
      { ...detectedResult, type: effectiveType },
      { tvShowsPath: settings.tvShowsPath, moviesPath: settings.moviesPath, softwarePath: settings.softwarePath, defaultPath },
      nameInfo
        ? { rawName: nameInfo.rawName, fileName: nameInfo.isHttp ? nameInfo.rawName : undefined }
        : {}
    );
    setOutput(path);
  };

  const handleMediaChoice = (choice) => {
    setMediaChoice(choice);
    setPickerOpen(false);
    if (detected) {
      applyDetectedOutput(detected, choice);
    }
  };

  // Update source when initialSource changes (e.g., from external click)
  useEffect(() => {
    if (initialSource) {
      setSource(initialSource);
    }
  }, [initialSource]);

  useEffect(() => {
    // Set default download path from settings
    if (settings.defaultDownloadPath && !output) {
      setOutput(settings.defaultDownloadPath);
    }
  }, [settings.defaultDownloadPath]);

  // Inspect source when it changes
  useEffect(() => {
    if (!source || !globalThis.electronAPI) return;

    const inspectSource = async () => {
      setInspecting(true);
      setInspectError(null);
      setTorrentInfo(null);
      setHttpInfo(null);
      setDetected(null);
      setMediaChoice(null);
      setPickerOpen(false);

      try {
        // Check if it's a torrent
        // Check for magnet links, .torrent extension (case-insensitive), or file paths
        const lowerSource = source.toLowerCase();
        const isTorrent = source.startsWith('magnet:') || 
                         source.endsWith('.torrent') || 
                         lowerSource.endsWith('.torrent') ||
                         (source.includes('.torrent') && !source.includes('?'));

        if (isTorrent) {
          console.log('Detected torrent source, inspecting:', source);
          // Try to inspect both magnet links and torrent files
          if (source.startsWith('magnet:')) {
            // For magnet links, show loading message immediately
            setInspectError('Fetching metadata from magnet link... This may take 10-30 seconds.');
          } else {
            // For torrent files, show loading message
            setInspectError('Reading torrent file...');
          }
          
          try {
            console.log('Calling inspectTorrent with source:', source);
            const info = await globalThis.electronAPI.inspectTorrent(source);
            console.log('Torrent inspection result:', info);
            setTorrentInfo(info);
            setInspectError(null);
            if (info.name) {
              const d = detectMediaType(info.name);
              const nameInfo = { rawName: info.name, isHttp: false };
              setDetected(d);
              setSourceNameInfo(nameInfo);
              applyDetectedOutput(d, null, nameInfo);
            }
          } catch (error) {
            console.error('Torrent inspection error:', error);
            if (source.startsWith('magnet:')) {
              // For magnet links, provide helpful error message
              if (error.message && error.message.includes('timeout')) {
                setInspectError('Metadata fetch timed out. The torrent may have no active seeders, or your connection is slow. You can still start the download.');
              } else {
                setInspectError(`Failed to fetch metadata: ${error.message || error}. You can still start the download to see details.`);
              }
            } else {
              setInspectError(`Failed to inspect torrent file: ${error.message || error}`);
            }
          }
        } else if (source.startsWith('http://') || source.startsWith('https://')) {
          // Get HTTP file info
          const info = await globalThis.electronAPI.getHTTPInfo(source);
          setHttpInfo(info);
          if (info.fileName) {
            const d = detectMediaType(info.fileName);
            const nameInfo = { rawName: info.fileName, isHttp: true };
            setDetected(d);
            setSourceNameInfo(nameInfo);
            applyDetectedOutput(d, null, nameInfo);
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

  // Auto-start download if:
  // 1. autoStart is true (from extension), OR
  // 2. source is a valid HTTP/HTTPS URL (pasted link)
  useEffect(() => {
    const isHttpUrl = source && (source.startsWith('http://') || source.startsWith('https://'));
    const shouldAutoStart = autoStart || isHttpUrl;
    
    if (shouldAutoStart && source && output && !loading && !inspecting && !downloadId) {
      // Wait a bit for HTTP info to be fetched
      if (isHttpUrl) {
        if (httpInfo || inspectError) {
          // HTTP info is ready (or failed), start the download
          console.log('[AddDownloadModal] Auto-starting HTTP download:', source);
          handleSubmit(null);
        }
      } else {
        // For torrents, wait for inspection or start anyway after a delay
        if (torrentInfo || inspectError) {
          console.log('[AddDownloadModal] Auto-starting torrent download:', source);
          handleSubmit(null);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, source, output, httpInfo, torrentInfo, inspectError, inspecting, loading, downloadId]);

  const handleSubmit = async (e) => {
    if (e) {
      e.preventDefault();
    }
    setLoading(true);
    
    try {
      // Include HTTP info metadata if available
      const downloadOptions = {
        concurrency: settings.concurrency,
        chunk_size: settings.chunkSize,
        limit: settings.rateLimit,
        bt_upload_limit: settings.uploadLimit,
        bt_sequential: settings.sequentialMode,
        bt_keep_seeding: settings.keepSeeding || false,
        bt_port: settings.torrentPort || 42069,
        connect_timeout: settings.connectTimeout,
        read_timeout: settings.readTimeout,
        retries: settings.retries,
      };
      
      // Add HTTP metadata if available
      if (httpInfo) {
        downloadOptions.httpInfo = httpInfo;
      }
      
      const id = await startDownload(source, output || undefined, downloadOptions);
      
      setDownloadId(id);
      
      // Auto-resume if autoStart is true
      if (autoStart && id) {
        console.log('[AddDownloadModal] Auto-starting download:', id);
        // Small delay to ensure download is created
        setTimeout(async () => {
          try {
            await resumeDownload(id);
            console.log('[AddDownloadModal] Download auto-resumed:', id);
          } catch (error) {
            console.error('[AddDownloadModal] Failed to auto-resume:', error);
          }
        }, 300);
      }
      
      if (!autoStart) {
        onClose();
      } else {
        // For auto-start, close after a short delay to show it started
        setTimeout(() => {
          onClose();
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to start download:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTorrent = async () => {
    if (globalThis.electronAPI) {
      try {
        const filePath = await globalThis.electronAPI.selectTorrentFile();
        if (filePath) {
          console.log('Selected torrent file:', filePath);
          setSource(filePath);
          // Force inspection by setting inspecting state
          setInspecting(true);
        }
      } catch (error) {
        console.error('Failed to select torrent file:', error);
      }
    }
  };

  const handleSelectFolder = async () => {
    if (globalThis.electronAPI) {
      try {
        const folderPath = await globalThis.electronAPI.selectDownloadFolder();
        if (folderPath) {
          setOutput(folderPath);
        }
      } catch (error) {
        console.error('Failed to select download folder:', error);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-backdrop-in">
      <div className="vibrancy rounded-2xl p-6 w-full max-w-md border theme-border shadow-soft-lg animate-modal-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold tracking-tight theme-text-primary">New Download</h2>
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

          {/* Media Type Detection */}
          {detected && (() => {
            const effectiveType = mediaChoice || detected.type;
            const resolved = !pickerOpen && (effectiveType === 'tv' || effectiveType === 'movie' || effectiveType === 'software');
            const typeLabel = effectiveType === 'tv' ? 'a TV show' : effectiveType === 'movie' ? 'a movie' : 'software';
            return (
            <div className="p-3 theme-bg-tertiary rounded-xl border theme-border animate-fade-in-up">
              {resolved ? (
                <div className="flex items-center gap-2 text-sm">
                  {effectiveType === 'tv' ? (
                    <Tv className="w-4 h-4 text-primary-400 flex-shrink-0" />
                  ) : effectiveType === 'movie' ? (
                    <Clapperboard className="w-4 h-4 text-primary-400 flex-shrink-0" />
                  ) : (
                    <Package className="w-4 h-4 text-primary-400 flex-shrink-0" />
                  )}
                  <span className="theme-text-secondary">
                    Detected as {typeLabel}:
                  </span>
                  <span className="theme-text-primary font-medium truncate">
                    {detected.title}
                    {detected.season && ` - Season ${detected.season}`}
                    {detected.year && ` (${detected.year})`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="text-xs theme-text-tertiary hover:theme-text-primary underline ml-auto flex-shrink-0"
                  >
                    Not right?
                  </button>
                </div>
              ) : mediaChoice === 'other' && !pickerOpen ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="theme-text-secondary">
                    Filed as a regular download (not library-sorted).
                  </span>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="text-xs theme-text-tertiary hover:theme-text-primary underline ml-auto flex-shrink-0"
                  >
                    Not right?
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-sm">
                  <span className="theme-text-secondary">What is this?</span>
                  <div className="flex gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => handleMediaChoice('tv')}
                      className="btn-secondary px-3 py-1 text-xs flex items-center gap-1.5"
                    >
                      <Tv className="w-3.5 h-3.5" />
                      TV Show
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMediaChoice('movie')}
                      className="btn-secondary px-3 py-1 text-xs flex items-center gap-1.5"
                    >
                      <Clapperboard className="w-3.5 h-3.5" />
                      Movie
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMediaChoice('software')}
                      className="btn-secondary px-3 py-1 text-xs flex items-center gap-1.5"
                    >
                      <Package className="w-3.5 h-3.5" />
                      Software
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMediaChoice('other')}
                      className="btn-secondary px-3 py-1 text-xs"
                    >
                      Other
                    </button>
                  </div>
                </div>
              )}
            </div>
            );
          })()}

          {/* Torrent Info Preview */}
          {inspecting && (
            <div className="flex items-center gap-2 text-sm theme-text-secondary">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Inspecting source...</span>
            </div>
          )}

          {inspectError && (
            <div className="flex items-start gap-2 p-3 theme-bg-tertiary rounded-xl border theme-border">
              <AlertCircle className="w-4 h-4 theme-text-tertiary flex-shrink-0 mt-0.5" />
              <p className="text-sm theme-text-tertiary">{inspectError}</p>
            </div>
          )}

          {torrentInfo && (
            <div className="p-4 theme-bg-tertiary rounded-xl border theme-border">
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
            <div className="p-4 theme-bg-tertiary rounded-xl border theme-border">
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

