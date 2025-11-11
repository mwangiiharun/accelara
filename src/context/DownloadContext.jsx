import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const DownloadContext = createContext();

export function DownloadProvider({ children }) {
  const [downloads, setDownloads] = useState([]);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({
    downloadRate: [],
    uploadRate: [],
    peers: [],
    seeds: [],
    httpStats: {
      downloadRate: [],
      maxDataPoints: 60,
    },
    torrentStats: {
      downloadRate: [],
      uploadRate: [],
      peers: [],
      seeds: [],
      maxDataPoints: 60,
    },
    maxDataPoints: 60,
  });

  useEffect(() => {
    // Load active downloads (including paused) and history on startup
    if (window.electronAPI) {
      // Load active downloads (including paused)
      window.electronAPI.getActiveDownloads()
        .then((activeDownloads) => {
          // Deduplicate by ID before setting
          const uniqueDownloads = activeDownloads.reduce((acc, download) => {
            if (!acc.find((d) => d.id === download.id)) {
              acc.push(download);
            }
            return acc;
          }, []);
          setDownloads(uniqueDownloads);
        })
        .catch((error) => {
          console.error('Failed to load active downloads:', error);
        });
      
      // Load history
      window.electronAPI.getDownloadHistory()
        .then(setHistory)
        .catch((error) => {
          console.error('Failed to load download history:', error);
        });
    }

    // Set up listeners
    if (window.electronAPI) {
      const updateHandler = (data) => {
        setDownloads((prev) => {
          const downloadId = data.download_id || data.downloadId;
          if (!downloadId) {
            return prev; // Skip if no download ID
          }
          
          const existing = prev.find((d) => d.id === downloadId);
          if (existing) {
            // If download is paused, don't allow status updates to change it to downloading
            if (existing.status === 'paused' && data.status && data.status !== 'paused') {
              // Ignore status updates that would change paused to another status
              return prev;
            }
            
            const updated = { 
              ...existing, 
              ...data,
              // Track speed history per download for HTTP downloads
              speedHistory: existing.type === 'http' && (data.speed || data.download_rate) 
                ? [...(existing.speedHistory || []).slice(-59), { time: Date.now(), value: data.speed || data.download_rate || 0 }]
                : existing.speedHistory || [],
              // Store chunk progress for HTTP downloads
              chunk_progress: data.chunk_progress || existing.chunk_progress || [],
              // Store merging progress
              merge_progress: data.merge_progress,
              merge_chunk: data.merge_chunk,
              merge_total: data.merge_total,
              merged_bytes: data.merged_bytes,
              total_bytes: data.total_bytes,
              // Store verification status
              verification: data.verification,
              verify_status: data.verify_status,
              chunk_total_size: data.chunk_total_size,
              expected_size: data.expected_size,
              file_size: data.file_size,
              verified: data.verified,
              // Store torrent name if available
              torrent_name: data.torrent_name || existing.torrent_name,
              // Store file progress for torrents
              file_progress: data.file_progress || existing.file_progress || [],
            };
            
            // Update global stats (aggregate all downloads) - always update for real-time display
            const rate = data.speed || data.download_rate || 0;
            const isHTTP = updated.type === 'http';
            const isTorrent = updated.type === 'torrent' || updated.type === 'magnet';
            
            if (rate > 0 || data.upload_rate > 0 || data.peers !== undefined || data.seeds !== undefined) {
              setStats((s) => {
                const newStats = {
                  ...s,
                  downloadRate: [...s.downloadRate.slice(-s.maxDataPoints + 1), { time: Date.now(), value: rate }],
                  uploadRate: [...s.uploadRate.slice(-s.maxDataPoints + 1), { time: Date.now(), value: data.upload_rate || 0 }],
                  peers: [...s.peers.slice(-s.maxDataPoints + 1), { time: Date.now(), value: data.peers || 0 }],
                  seeds: [...s.seeds.slice(-s.maxDataPoints + 1), { time: Date.now(), value: data.seeds || 0 }],
                };
                
                // Separate HTTP stats
                if (isHTTP && rate > 0) {
                  newStats.httpStats = {
                    ...s.httpStats,
                    downloadRate: [...s.httpStats.downloadRate.slice(-s.httpStats.maxDataPoints + 1), { time: Date.now(), value: rate }],
                  };
                }
                
                // Separate torrent stats
                if (isTorrent) {
                  newStats.torrentStats = {
                    ...s.torrentStats,
                    downloadRate: [...s.torrentStats.downloadRate.slice(-s.torrentStats.maxDataPoints + 1), { time: Date.now(), value: rate }],
                    uploadRate: [...s.torrentStats.uploadRate.slice(-s.torrentStats.maxDataPoints + 1), { time: Date.now(), value: data.upload_rate || 0 }],
                    peers: [...s.torrentStats.peers.slice(-s.torrentStats.maxDataPoints + 1), { time: Date.now(), value: data.peers || 0 }],
                    seeds: [...s.torrentStats.seeds.slice(-s.torrentStats.maxDataPoints + 1), { time: Date.now(), value: data.seeds || 0 }],
                  };
                }
                
                return newStats;
              });
            }
            
            return prev.map((d) => (d.id === downloadId ? updated : d));
          } else {
            // Download doesn't exist in state - add it (e.g., from reattachToDownloads)
            // Only add if it has required fields
            if (data.source && data.status) {
              const newDownload = {
                id: downloadId,
                downloadId: downloadId,
                download_id: downloadId,
                source: data.source,
                output: data.output || '',
                type: data.type || (data.source.startsWith('magnet:') ? 'magnet' : data.source.endsWith('.torrent') ? 'torrent' : 'http'),
                status: data.status,
                progress: data.progress || 0,
                downloaded: data.downloaded || 0,
                total: data.total || 0,
                speed: data.speed || data.download_rate || 0,
                eta: data.eta || 0,
                speedHistory: data.speedHistory || [],
                peers: data.peers || 0,
                seeds: data.seeds || 0,
                ...data,
              };
              // Check if it's already in the list (by ID) to prevent duplicates
              if (!prev.find((d) => d.id === downloadId)) {
                return [...prev, newDownload];
              }
            }
          }
          return prev;
        });
      };

      const completeHandler = (data) => {
        setDownloads((prev) => {
          const downloadId = data.download_id || data.downloadId;
          const completed = prev.find((d) => d.id === downloadId);
          if (completed) {
            // Dispatch custom event for toast notification
            if (data.success !== false) {
              const fileName = completed.torrent_name || completed.source.split('/').pop() || 'Download';
              window.dispatchEvent(new CustomEvent('download-completed', { 
                detail: { fileName, output: data.output || completed.output } 
              }));
            }
            
            // Remove from active downloads immediately
            const filtered = prev.filter((d) => d.id !== downloadId);
            
            // Reload history from database (don't manually add to state to avoid duplicates)
            if (window.electronAPI) {
              window.electronAPI.getDownloadHistory()
                .then(setHistory)
                .catch((error) => {
                  console.error('Failed to reload download history:', error);
                });
            }
            
            return filtered;
          }
          return prev;
        });
      };

      window.electronAPI.onDownloadUpdate(updateHandler);
      window.electronAPI.onDownloadComplete(completeHandler);

      return () => {
        window.electronAPI.removeListeners('download-update');
        window.electronAPI.removeListeners('download-complete');
      };
    }
  }, []);

  const startDownload = useCallback(async (source, output, options) => {
    if (!window.electronAPI) {
      console.error('Electron API not available');
      return null;
    }

    // Check if download already exists in state to prevent duplicates
    let existingDownloadId = null;
    setDownloads((prev) => {
      const existing = prev.find((d) => 
        d.source === source && 
        (d.output === output || (!output && !d.output))
      );
      if (existing && (existing.status === 'downloading' || existing.status === 'initializing' || existing.status === 'paused')) {
        // Download already exists and is active - reuse existing ID
        existingDownloadId = existing.id;
        return prev;
      }
      return prev;
    });

    // If download already exists, return its ID without starting a new one
    if (existingDownloadId) {
      return existingDownloadId;
    }

    const result = await window.electronAPI.startDownload({
      source,
      output,
      options,
    });

    // Check again after starting to prevent duplicate in state
    setDownloads((prev) => {
      // If download already exists (from updateHandler or getActiveDownloads), update it instead of adding
      const existing = prev.find((d) => d.id === result.downloadId);
      if (existing) {
        return prev.map((d) => 
          d.id === result.downloadId 
            ? { ...d, status: 'initializing', source, output, ...options }
            : d
        );
      }
      
      // Add new download only if it doesn't exist
      const newDownload = {
        id: result.downloadId,
        source,
        output,
        type: source.startsWith('magnet:') ? 'magnet' : source.endsWith('.torrent') ? 'torrent' : 'http',
        status: 'initializing',
        progress: 0,
        speed: 0,
        eta: 0,
        speedHistory: [],
        peers: 0,
        seeds: 0,
        ...options,
      };
      return [...prev, newDownload];
    });
    
    return result.downloadId;
  }, []);

  const stopDownload = useCallback(async (downloadId) => {
    if (window.electronAPI) {
      await window.electronAPI.stopDownload(downloadId);
      setDownloads((prev) => prev.filter((d) => d.id !== downloadId));
    }
  }, []);

  const pauseDownload = useCallback(async (downloadId) => {
    if (window.electronAPI) {
      await window.electronAPI.pauseDownload(downloadId);
      setDownloads((prev) => prev.map((d) => d.id === downloadId ? { ...d, status: 'paused' } : d));
    }
  }, []);

  const resumeDownload = useCallback(async (downloadId) => {
    if (window.electronAPI) {
      await window.electronAPI.resumeDownload(downloadId);
      setDownloads((prev) => prev.map((d) => d.id === downloadId ? { ...d, status: 'downloading' } : d));
    }
  }, []);

  const removeDownload = useCallback(async (downloadId) => {
    if (window.electronAPI) {
      await window.electronAPI.removeDownload(downloadId);
      setDownloads((prev) => prev.filter((d) => d.id !== downloadId));
    }
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return (
    <DownloadContext.Provider value={{ downloads, history, stats, startDownload, stopDownload, pauseDownload, resumeDownload, removeDownload, clearHistory }}>
      {children}
    </DownloadContext.Provider>
  );
}

export function useDownloads() {
  return useContext(DownloadContext);
}

