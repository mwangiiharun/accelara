import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const DownloadContext = createContext();

export function DownloadProvider({ children }) {
  const [downloads, setDownloads] = useState([]);
  const [history, setHistory] = useState([]);
  const [highlightedDownloadId, setHighlightedDownloadId] = useState(null);
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
          
          // Set default highlighted download to the earliest one (only on initial load)
          setHighlightedDownloadId((current) => {
            if (current) return current; // Don't override if already set
            if (uniqueDownloads.length > 0) {
              // Sort by started_at if available, otherwise use array order
              const sorted = [...uniqueDownloads].sort((a, b) => {
                const aTime = a.started_at || a.id || 0;
                const bTime = b.started_at || b.id || 0;
                return aTime - bTime;
              });
              return sorted[0].id;
            }
            return current;
          });
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
            // Exception: if auto_paused flag is set, we still want to respect manual resume
            // Also allow status updates if the download is in "initializing" state (user clicked resume)
            const isAutoPaused = existing.auto_paused === true;
            const isInitializing = existing.status === 'initializing';
            if (existing.status === 'paused' && data.status && data.status !== 'paused' && !isAutoPaused && !isInitializing) {
              // Ignore status updates that would change paused to another status
              // (unless it was auto-paused or initializing, in which case user can manually resume)
              return prev;
            }
            
            // If this is a restored progress update, ALWAYS use the restored values
            // This ensures we restore the correct progress even if frontend state is wrong
            if (data.restored) {
              // Use restored values directly - don't merge with existing
              // The restored values come from the database and are authoritative
              console.log(`[DownloadContext] Restoring progress for ${downloadId}: ${data.downloaded} bytes (${((data.progress || 0) * 100).toFixed(2)}%)`);
              // Keep the restored values as-is - they're already in data
              // Continue to update the download with restored values
            } else {
              // Prevent progress from going backwards (e.g., from 600MB to 0MB on resume)
              // Only allow progress to decrease if it's explicitly a reset (e.g., new download)
              if (data.progress !== undefined && data.downloaded !== undefined && 
                  existing.downloaded > 0 && data.downloaded < existing.downloaded && 
                  data.downloaded === 0 && existing.downloaded > 1000) {
                // Progress went backwards significantly (e.g., from 600MB to 0MB)
                // This likely means the Go binary hasn't checked for existing files yet
                // Keep the existing progress and wait for the next update
                console.log(`[DownloadContext] Ignoring progress reset for ${downloadId}: ${existing.downloaded} -> ${data.downloaded}`);
                return prev;
              }
            }
            
            // Check if download is progressing successfully - clear errors if so
            const isProgressing = (data.status === 'downloading' || data.status === 'seeding') && 
                                   ((data.speed || data.download_rate || 0) > 0 || 
                                    (data.progress !== undefined && data.progress > (existing.progress || 0)));
            
            // Clear error/message if download is progressing successfully
            let clearedError = existing.error;
            let clearedMessage = existing.message;
            let clearedMessages = existing.messages || [];
            
            if (isProgressing && existing.error) {
              // Download is progressing - clear previous errors
              clearedError = null;
            }
            
            if (isProgressing && existing.message && 
                (existing.message.includes('announce failed') || 
                 existing.message.includes('write error') ||
                 existing.message.includes('no route to host') ||
                 existing.message.includes('timeout'))) {
              // Clear transient error messages when download progresses
              clearedMessage = null;
              // Remove transient error messages from history
              clearedMessages = clearedMessages.filter(msg => 
                !(msg.text && (
                  msg.text.includes('announce failed') ||
                  msg.text.includes('write error') ||
                  msg.text.includes('no route to host') ||
                  msg.text.includes('timeout')
                ))
              );
            }
            
            // Add new message if provided
            if (data.message) {
              clearedMessages = [...clearedMessages.slice(-9), { 
                time: Date.now(), 
                type: data.status === 'error' ? 'error' : (data.status === 'info' ? 'info' : 'message'),
                text: data.message 
              }];
            }
            
            // Track speed history for all download types
            let speedHistory = existing.speedHistory || [];
            if (data.speed || data.download_rate) {
              speedHistory = [...speedHistory.slice(-59), { time: Date.now(), value: data.speed || data.download_rate || 0 }];
            }
            
            // Track upload history for torrent downloads
            let uploadHistory = existing.uploadHistory || [];
            if ((existing.type === 'torrent' || existing.type === 'magnet') && data.upload_rate !== undefined) {
              uploadHistory = [...uploadHistory.slice(-59), { time: Date.now(), value: data.upload_rate || 0 }];
            }
            
            // Track peers history for torrent downloads
            let peersHistory = existing.peersHistory || [];
            if ((existing.type === 'torrent' || existing.type === 'magnet') && data.peers !== undefined) {
              peersHistory = [...peersHistory.slice(-59), { time: Date.now(), value: data.peers || 0 }];
            }
            
            // Track seeds history for torrent downloads
            let seedsHistory = existing.seedsHistory || [];
            if ((existing.type === 'torrent' || existing.type === 'magnet') && data.seeds !== undefined) {
              seedsHistory = [...seedsHistory.slice(-59), { time: Date.now(), value: data.seeds || 0 }];
            }
            
            // If this is restored progress, ensure we preserve it even if data has 0 values
            let finalData = { ...data };
            if (data.restored) {
              // Restored progress is authoritative - use it directly
              finalData.downloaded = data.downloaded || existing.downloaded || 0;
              finalData.progress = data.progress !== undefined ? data.progress : existing.progress || 0;
              finalData.total = data.total || existing.total || 0;
              // Mark as restored so we know not to accept 0 updates later
              finalData._hasRestoredProgress = true;
            } else if (existing._hasRestoredProgress && data.downloaded === 0 && existing.downloaded > 0) {
              // This download has restored progress, don't allow 0 to overwrite it
              console.log(`[DownloadContext] Preserving restored progress for ${downloadId}: ignoring 0 update`);
              finalData.downloaded = existing.downloaded;
              finalData.progress = existing.progress;
              finalData.total = existing.total;
            }
            
            const updated = { 
              ...existing, 
              ...finalData,
              speedHistory,
              uploadHistory,
              peersHistory,
              seedsHistory,
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
              // Store HTTP info and fileName if available
              fileName: data.fileName || (data.httpInfo?.fileName) || existing.fileName,
              httpInfo: data.httpInfo || existing.httpInfo,
              // Store file progress for torrents
              file_progress: data.file_progress || existing.file_progress || [],
              // Store error and info messages (cleared if download is progressing)
              error: data.error || clearedError,
              message: data.message || clearedMessage,
              messages: clearedMessages,
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
                uploadHistory: data.uploadHistory || [],
                peersHistory: data.peersHistory || [],
                seedsHistory: data.seedsHistory || [],
                peers: data.peers || 0,
                seeds: data.seeds || 0,
                fileName: data.fileName || (data.httpInfo?.fileName) || null,
                httpInfo: data.httpInfo || null,
                ...data,
              };
              // Check if it's already in the list (by ID) to prevent duplicates
              if (!prev.find((d) => d.id === downloadId)) {
                const updated = [...prev, newDownload];
                // Set as highlighted if it's the first download or no download is highlighted
                if (updated.length === 1 || !highlightedDownloadId) {
                  setHighlightedDownloadId(downloadId);
                }
                return updated;
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
            
            // If the highlighted download was removed, select the earliest remaining one
            setHighlightedDownloadId((current) => {
              if (current === downloadId) {
                // Find the earliest remaining download
                if (filtered.length > 0) {
                  const sorted = [...filtered].sort((a, b) => {
                    const aTime = a.started_at || a.id || 0;
                    const bTime = b.started_at || b.id || 0;
                    return aTime - bTime;
                  });
                  return sorted[0].id;
                }
                return null;
              }
              return current;
            });
            
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
      
      // Extract HTTP info from options if available
      const httpInfo = options?.httpInfo;
      const fileName = httpInfo?.fileName || (output ? output.split('/').pop() : null);
      
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
        fileName: fileName,
        httpInfo: httpInfo,
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
      console.log('[DownloadContext] Resuming download:', downloadId);
      try {
        await window.electronAPI.resumeDownload(downloadId);
        setDownloads((prev) => prev.map((d) => d.id === downloadId ? { ...d, status: 'downloading' } : d));
      } catch (error) {
        console.error('[DownloadContext] Failed to resume download:', downloadId, error);
        // Update status to error on failure
        setDownloads((prev) => prev.map((d) => d.id === downloadId ? { ...d, status: 'error', error: error.message || String(error) } : d));
      }
    }
  }, []);

  const removeDownload = useCallback(async (downloadId) => {
    if (window.electronAPI) {
      await window.electronAPI.removeDownload(downloadId);
      setDownloads((prev) => {
        const filtered = prev.filter((d) => d.id !== downloadId);
        
        // If the highlighted download was removed, select the earliest remaining one
        setHighlightedDownloadId((current) => {
          if (current === downloadId) {
            if (filtered.length > 0) {
              const sorted = [...filtered].sort((a, b) => {
                const aTime = a.started_at || a.id || 0;
                const bTime = b.started_at || b.id || 0;
                return aTime - bTime;
              });
              return sorted[0].id;
            }
            return null;
          }
          return current;
        });
        
        return filtered;
      });
    }
  }, []);

  const retryDownload = useCallback(async (downloadId) => {
    if (!window.electronAPI) {
      console.error('Electron API not available');
      return;
    }

    // Find the download to retry
    const download = downloads.find((d) => d.id === downloadId);
    if (!download) {
      console.error('Download not found:', downloadId);
      return;
    }

    try {
      // Update status to initializing
      setDownloads((prev) => prev.map((d) => 
        d.id === downloadId 
          ? { ...d, status: 'initializing', error: null, message: null }
          : d
      ));

      // For magnet links, re-inspect first
      if (download.type === 'magnet' && download.source && download.source.startsWith('magnet:')) {
        console.log('[DownloadContext] Re-inspecting magnet link before retry:', download.source);
        
        try {
          // Re-inspect the magnet link
          const torrentInfo = await window.electronAPI.inspectTorrent(download.source);
          console.log('[DownloadContext] Re-inspection successful:', torrentInfo);
          
          // Update download with torrent info
          setDownloads((prev) => prev.map((d) => 
            d.id === downloadId 
              ? { 
                  ...d, 
                  torrent_name: torrentInfo.name,
                  total: torrentInfo.totalSize,
                  fileCount: torrentInfo.fileCount,
                  files: torrentInfo.files,
                }
              : d
          ));
        } catch (inspectError) {
          console.warn('[DownloadContext] Re-inspection failed, continuing with retry:', inspectError);
          // Continue with retry even if inspection fails
        }
      }

      // Stop the old download first (if it's still running)
      try {
        await window.electronAPI.stopDownload(downloadId);
      } catch (stopError) {
        // Ignore errors when stopping (download might already be stopped)
        console.log('[DownloadContext] Error stopping download (may already be stopped):', stopError);
      }

      // Remove the old download from the database
      try {
        await window.electronAPI.removeDownload(downloadId);
      } catch (removeError) {
        // Ignore errors when removing (download might not exist in DB)
        console.log('[DownloadContext] Error removing download (may not exist):', removeError);
      }

      // Prepare options from existing download settings
      const options = {
        concurrency: download.concurrency || 8,
        chunk_size: download.chunk_size || '4MB',
        limit: download.limit || '',
        bt_upload_limit: download.bt_upload_limit || '',
        bt_sequential: download.bt_sequential || false,
        bt_keep_seeding: download.bt_keep_seeding || false,
        bt_port: download.bt_port || 42069,
        connect_timeout: download.connect_timeout || 15,
        read_timeout: download.read_timeout || 60,
        retries: download.retries || 5,
      };

      // Add HTTP info if available
      if (download.httpInfo) {
        options.httpInfo = download.httpInfo;
      }

      // Remove the old download from state FIRST, before starting the new one
      // This prevents duplicates when the updateHandler receives the new download
      setDownloads((prev) => prev.filter((d) => d.id !== downloadId));

      // Start a new download with the same source and output
      const result = await window.electronAPI.startDownload({
        source: download.source,
        output: download.output,
        options,
      });

      // Update highlighted download ID if the retried download was highlighted
      setHighlightedDownloadId((current) => {
        if (current === downloadId) {
          return result.downloadId;
        }
        return current;
      });

      // Don't manually add the download here - let the updateHandler add it
      // when it receives the first update event from the backend
      // The updateHandler already checks for duplicates by ID (line 299)
      // This prevents duplicates

      // Auto-resume the new download
      setTimeout(async () => {
        try {
          await window.electronAPI.resumeDownload(result.downloadId);
          setDownloads((prev) => prev.map((d) => 
            d.id === result.downloadId 
              ? { ...d, status: 'downloading' }
              : d
          ));
        } catch (resumeError) {
          console.error('[DownloadContext] Failed to auto-resume retried download:', resumeError);
          setDownloads((prev) => prev.map((d) => 
            d.id === result.downloadId 
              ? { ...d, status: 'error', error: resumeError.message || String(resumeError) }
              : d
          ));
        }
      }, 300);

    } catch (error) {
      console.error('[DownloadContext] Failed to retry download:', error);
      setDownloads((prev) => prev.map((d) => 
        d.id === downloadId 
          ? { ...d, status: 'error', error: error.message || String(error) }
          : d
      ));
    }
  }, [downloads]);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return (
    <DownloadContext.Provider value={{ 
      downloads, 
      history, 
      stats, 
      highlightedDownloadId,
      setHighlightedDownloadId,
      startDownload, 
      stopDownload, 
      pauseDownload, 
      resumeDownload, 
      removeDownload,
      retryDownload,
      clearHistory 
    }}>
      {children}
    </DownloadContext.Provider>
  );
}

export function useDownloads() {
  return useContext(DownloadContext);
}

