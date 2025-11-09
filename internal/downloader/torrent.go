package downloader

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
	"golang.org/x/time/rate"
)

type TorrentDownloader struct {
	source        string
	outPath       string
	uploadLimit   int64
	downloadLimit int64
	sequential    bool
	keepSeeding   bool
	quiet         bool
	reporter      StatusReporter
	downloadID    string // For state persistence
	
	// For accurate speed calculation
	lastBytesRead    int64
	lastBytesWritten int64
	lastStatsTime    time.Time
	speedHistory     []int64 // Moving average for speed smoothing
}

func NewTorrentDownloader(source, outPath string, opts Options) *TorrentDownloader {
	return &TorrentDownloader{
		source:        source,
		outPath:       outPath,
		uploadLimit:   opts.BTUploadLimit,
		downloadLimit: opts.RateLimit,
		sequential:    opts.BTSequential,
		keepSeeding:   opts.BTKeepSeeding,
		quiet:         opts.Quiet,
		reporter:      opts.StatusReporter,
		downloadID:    opts.DownloadID,
	}
}

func (d *TorrentDownloader) Download() error {
	cfg := torrent.NewDefaultClientConfig()
	if info, err := os.Stat(d.outPath); err == nil && info.IsDir() {
		cfg.DataDir = d.outPath
	} else {
		cfg.DataDir = filepath.Dir(d.outPath)
	}

	if d.uploadLimit > 0 {
		cfg.UploadRateLimiter = rate.NewLimiter(rate.Limit(d.uploadLimit), int(d.uploadLimit))
	}
	if d.downloadLimit > 0 {
		cfg.DownloadRateLimiter = rate.NewLimiter(rate.Limit(d.downloadLimit), int(d.downloadLimit))
	}

	client, err := torrent.NewClient(cfg)
	if err != nil {
		return fmt.Errorf("failed to create torrent client: %w", err)
	}
	defer client.Close()

	var t *torrent.Torrent
	if len(d.source) >= 7 && d.source[:7] == "magnet:" {
		var err error
		t, err = client.AddMagnet(d.source)
		if err != nil {
			return fmt.Errorf("failed to add magnet: %w", err)
		}
	} else {
		var mi *metainfo.MetaInfo
		if len(d.source) >= 4 && (d.source[:4] == "http" || d.source[:5] == "https") {
			resp, err := http.Get(d.source)
			if err != nil {
				return fmt.Errorf("failed to fetch torrent: %w", err)
			}
			defer resp.Body.Close()
			mi, err = metainfo.Load(resp.Body)
			if err != nil {
				return fmt.Errorf("failed to parse torrent: %w", err)
			}
		} else {
			file, err := os.Open(d.source)
			if err != nil {
				return fmt.Errorf("failed to open torrent file: %w", err)
			}
			defer file.Close()
			mi, err = metainfo.Load(file)
			if err != nil {
				return fmt.Errorf("failed to parse torrent: %w", err)
			}
		}
		t, err = client.AddTorrent(mi)
		if err != nil {
			return fmt.Errorf("failed to add torrent: %w", err)
		}
	}

	t.DownloadAll()
	if d.sequential {
		for _, f := range t.Files() {
			f.SetPriority(torrent.PiecePriorityNow)
		}
	}

	if d.reporter != nil {
		d.reporter.Report(map[string]interface{}{
			"type":     "torrent",
			"status":   "getting_metadata",
			"progress": 0.0,
		})
	}

	<-t.GotInfo()

	info := t.Info()
	if info == nil {
		return fmt.Errorf("failed to get torrent info")
	}

	// Check existing files and verify pieces before starting
	if d.reporter != nil {
		d.reporter.Report(map[string]interface{}{
			"type":     "torrent",
			"status":   "verifying",
			"progress": 0.0,
			"verify_status": "checking_existing_files",
		})
	}

	// Check existing files and their sizes
	existingBytes := int64(0)
	dataDir := cfg.DataDir
	if info.IsDir() {
		// Multi-file torrent - check if directory exists
		torrentDir := filepath.Join(dataDir, info.Name)
		if dirInfo, err := os.Stat(torrentDir); err == nil && dirInfo.IsDir() {
			// Check each file in the torrent
			for _, file := range info.Files {
				filePath := filepath.Join(torrentDir, filepath.Join(file.Path...))
				if fileInfo, err := os.Stat(filePath); err == nil {
					existingBytes += fileInfo.Size()
				}
			}
		}
	} else {
		// Single-file torrent
		filePath := filepath.Join(dataDir, info.Name)
		if fileInfo, err := os.Stat(filePath); err == nil {
			existingBytes = fileInfo.Size()
		}
	}

	// The torrent library will automatically verify pieces and resume
	// We just need to report the initial state
	if existingBytes > 0 {
		// Trigger piece verification by checking completion
		initialCompleted := t.BytesCompleted()
		if d.reporter != nil {
			d.reporter.Report(map[string]interface{}{
				"type":          "torrent",
				"status":        "verifying",
				"progress":      float64(initialCompleted) / float64(info.TotalLength()),
				"downloaded":    initialCompleted,
				"total":         info.TotalLength(),
				"verify_status": "verifying_pieces",
			})
		}
		
		// Wait a bit for initial verification to complete
		time.Sleep(500 * time.Millisecond)
	}

	// For multi-file torrents, enable parallel downloads by not using sequential mode
	// unless explicitly requested
	if !d.sequential {
		// Set all files to normal priority to allow parallel downloads
		for _, f := range t.Files() {
			f.SetPriority(torrent.PiecePriorityNormal)
		}
	} else {
		// Sequential mode - download files one by one
		for _, f := range t.Files() {
			f.SetPriority(torrent.PiecePriorityNow)
		}
	}

	lastPieceStateUpdate := time.Now()
	lastStatsTime := time.Time{} // Initialize to zero time so we can detect first update
	lastBytesRead := int64(0)
	lastBytesWritten := int64(0)
	speedHistory := make([]int64, 0, 10) // Keep last 10 speed samples for smoothing
	lastValidSpeed := int64(0) // Keep last valid speed to persist when connection drops
	lastValidUploadSpeed := int64(0)
	ticker := time.NewTicker(200 * time.Millisecond) // More frequent updates for torrents
	defer ticker.Stop()

	for {
		select {
		case <-t.Closed():
			return nil
		case <-ticker.C:
			stats := t.Stats()
			info := t.Info()
			var progress float64
			var totalBytes int64
			var completedBytes int64

			if info != nil {
				totalBytes = info.TotalLength()
				completedBytes = t.BytesCompleted()
				if totalBytes > 0 {
					progress = float64(completedBytes) / float64(totalBytes)
				}
			}

			// Always report for torrents to show activity
			if d.reporter != nil {
				now := time.Now()
				currentBytesRead := stats.BytesReadUsefulData.Int64()
				currentBytesWritten := stats.BytesWrittenData.Int64()
				
				// Calculate download rate from cumulative bytes read
				// BytesReadUsefulData is cumulative, so we need to track the difference
				var downloadRate int64 = 0
				var uploadRate int64 = 0
				
				elapsed := now.Sub(lastStatsTime).Seconds()
				if elapsed > 0 && lastStatsTime.After(time.Time{}) {
					// Calculate rate from cumulative counter difference
					bytesReadDelta := currentBytesRead - lastBytesRead
					bytesWrittenDelta := currentBytesWritten - lastBytesWritten
					
					// Only calculate if delta is non-negative (counters should only increase)
					if bytesReadDelta >= 0 {
						instantRate := int64(float64(bytesReadDelta) / elapsed)
						
						// Only add non-zero rates to history (connection is active)
						if instantRate > 0 {
							// Add to speed history for smoothing (keep last 10 samples, ~2 seconds of data)
							speedHistory = append(speedHistory, instantRate)
							if len(speedHistory) > 10 {
								speedHistory = speedHistory[1:]
							}
							
							// Calculate smoothed average speed from history
							if len(speedHistory) > 0 {
								var sum int64 = 0
								for _, s := range speedHistory {
									sum += s
								}
								downloadRate = sum / int64(len(speedHistory))
								lastValidSpeed = downloadRate // Update last valid speed
							}
						} else {
							// Connection dropped or paused - use last valid speed
							downloadRate = lastValidSpeed
						}
					} else {
						// Counter went backwards (shouldn't happen) - use last valid speed
						downloadRate = lastValidSpeed
					}
					
					if bytesWrittenDelta >= 0 {
						calculatedUploadRate := int64(float64(bytesWrittenDelta) / elapsed)
						if calculatedUploadRate > 0 {
							uploadRate = calculatedUploadRate
							lastValidUploadSpeed = uploadRate
						} else {
							uploadRate = lastValidUploadSpeed
						}
					} else {
						uploadRate = lastValidUploadSpeed
					}
				} else {
					// First update - initialize counters, will calculate rate on next update
					downloadRate = 0
					uploadRate = 0
				}
				
				// Update tracking variables
				lastBytesRead = currentBytesRead
				lastBytesWritten = currentBytesWritten
				lastStatsTime = now
				
				// Calculate ETA based on current download rate
				var eta float64 = 0
				if downloadRate > 0 && totalBytes > 0 && completedBytes < totalBytes {
					remaining := totalBytes - completedBytes
					eta = float64(remaining) / float64(downloadRate)
				}
				
				// Get piece completion state for integrity tracking
				pieceCount := t.NumPieces()
				completedPieces := 0
				pieceStates := make([]bool, pieceCount)
				for i := 0; i < pieceCount; i++ {
					pieceState := t.PieceState(i)
					isComplete := pieceState.Complete
					pieceStates[i] = isComplete
					if isComplete {
						completedPieces++
					}
				}
				
				// Get file-level progress for multi-file torrents
				var fileProgress []map[string]interface{}
				if info != nil && len(info.Files) > 1 {
					files := t.Files()
					for i, file := range files {
						fileInfo := file.FileInfo()
						fileCompleted := file.BytesCompleted()
						fileTotal := fileInfo.Length
						fileProgressValue := float64(0)
						if fileTotal > 0 {
							fileProgressValue = float64(fileCompleted) / float64(fileTotal)
						}
						
						// Build file path
						filePath := ""
						if len(fileInfo.Path) > 0 {
							filePath = filepath.Join(fileInfo.Path...)
						} else {
							filePath = info.Name
						}
						
						fileProgress = append(fileProgress, map[string]interface{}{
							"index":     i,
							"path":      filePath,
							"name":      filepath.Base(filePath),
							"progress":  fileProgressValue,
							"downloaded": fileCompleted,
							"total":     fileTotal,
						})
					}
				}
				
				reportData := map[string]interface{}{
					"type":          "torrent",
					"status":        "downloading",
					"progress":      progress,
					"downloaded":    completedBytes,
					"total":         totalBytes,
					"download_rate": downloadRate,
					"speed":         downloadRate,
					"upload_rate":   uploadRate,
					"peers":         stats.ActivePeers,
					"seeds":         stats.ConnectedSeeders,
					"eta":           eta,
					"piece_count":   pieceCount,
					"completed_pieces": completedPieces,
					"piece_states":  pieceStates, // For integrity verification
				}
				
				// Add file progress if available
				if len(fileProgress) > 0 {
					reportData["file_progress"] = fileProgress
				}
				
				// Add torrent name (file/folder name) if available
				if info != nil && info.Name != "" {
					reportData["torrent_name"] = info.Name
				}
				
				// Add info hash for state persistence
				infoHash := t.InfoHash()
				infoHashStr := infoHash.HexString()
				if infoHashStr != "" {
					reportData["info_hash"] = infoHashStr
				}
				
				d.reporter.Report(reportData)
				
				// Update piece state in database periodically (every 5 seconds)
				if time.Since(lastPieceStateUpdate) > 5*time.Second && d.downloadID != "" {
					// Piece states are included in the report, which will be stored in metadata
					lastPieceStateUpdate = time.Now()
				}
			}

			if totalBytes > 0 && completedBytes >= totalBytes {
				// Get final piece state for integrity verification
				pieceCount := t.NumPieces()
				completedPieces := 0
				pieceStates := make([]bool, pieceCount)
				for i := 0; i < pieceCount; i++ {
					pieceState := t.PieceState(i)
					isComplete := pieceState.Complete
					pieceStates[i] = isComplete
					if isComplete {
						completedPieces++
					}
				}
				
				if d.reporter != nil {
					reportData := map[string]interface{}{
						"type":            "torrent",
						"status":          "seeding",
						"progress":        1.0,
						"downloaded":      completedBytes,
						"total":           totalBytes,
						"download_rate":   int64(stats.BytesReadUsefulData.Int64()),
						"upload_rate":     int64(stats.BytesWrittenData.Int64()),
						"peers":           stats.ActivePeers,
						"seeds":           stats.ConnectedSeeders,
						"piece_count":     pieceCount,
						"completed_pieces": completedPieces,
						"piece_states":    pieceStates,
						"verify_status":   "verified",
					}
					if info != nil && info.Name != "" {
						reportData["torrent_name"] = info.Name
					}
					infoHash := t.InfoHash()
					infoHashStr := infoHash.HexString()
					if infoHashStr != "" {
						reportData["info_hash"] = infoHashStr
					}
					d.reporter.Report(reportData)
				}
				
				// If keepSeeding is false, exit after completion
				if !d.keepSeeding {
					return nil
				}
				
				// Continue seeding and reporting stats
				if d.reporter != nil {
					reportData := map[string]interface{}{
						"type":            "torrent",
						"status":          "seeding",
						"progress":        1.0,
						"downloaded":      completedBytes,
						"total":           totalBytes,
						"download_rate":   int64(stats.BytesReadUsefulData.Int64()),
						"speed":           int64(stats.BytesReadUsefulData.Int64()),
						"upload_rate":     int64(stats.BytesWrittenData.Int64()),
						"peers":           stats.ActivePeers,
						"seeds":           stats.ConnectedSeeders,
						"eta":             0,
						"piece_count":     pieceCount,
						"completed_pieces": completedPieces,
						"piece_states":    pieceStates,
						"verify_status":   "verified",
					}
					if info != nil && info.Name != "" {
						reportData["torrent_name"] = info.Name
					}
					infoHash := t.InfoHash()
					infoHashStr := infoHash.HexString()
					if infoHashStr != "" {
						reportData["info_hash"] = infoHashStr
					}
					d.reporter.Report(reportData)
				}
			}
		}
	}
}
