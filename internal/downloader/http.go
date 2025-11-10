package downloader

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type HTTPDownloader struct {
	sourceURL      string
	outPath        string
	tempDir        string
	chunkSize      int64
	concurrency    int
	rateLimit      int64
	proxy          string
	retries        int
	connectTimeout time.Duration
	readTimeout    time.Duration
	sha256         string
	quiet          bool
	reporter       StatusReporter
	downloadID     string // For state persistence

	client          *http.Client
	totalSize       int64
	acceptRanges    bool
	chunks          []chunk
	chunkProgress   []int64
	downloaded      int64
	downloadedMutex sync.Mutex
	chunkMutex      sync.Mutex
	
	// For accurate speed calculation across concurrent chunks
	lastReportedDownloaded int64
	lastReportedTime       time.Time
	speedMutex             sync.Mutex
	
	// For detecting multi-connection issues
	multiConnectionFailed bool
	multiConnectionMutex  sync.Mutex
	
	// For connection failure tracking and retry
	connectionFailures    int
	maxConnectionFailures int
	lastFailureTime       time.Time
	connectionFailureMutex sync.Mutex
	paused                bool
	pauseReason           string
	pauseMutex            sync.Mutex
}

type chunk struct {
	start int64
	end   int64
}

func NewHTTPDownloader(sourceURL, outPath string, opts Options) *HTTPDownloader {
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
	}
	if opts.Proxy != "" {
		proxyURL, err := url.Parse(opts.Proxy)
		if err == nil {
			transport.Proxy = http.ProxyURL(proxyURL)
		}
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   time.Duration(opts.ConnectTimeout) * time.Second,
	}

	return &HTTPDownloader{
		sourceURL:           sourceURL,
		outPath:             outPath,
		chunkSize:           opts.ChunkSize,
		concurrency:         opts.Connections,
		rateLimit:           opts.RateLimit,
		proxy:               opts.Proxy,
		retries:             opts.Retries,
		connectTimeout:      time.Duration(opts.ConnectTimeout) * time.Second,
		readTimeout:         time.Duration(opts.ReadTimeout) * time.Second,
		sha256:              opts.SHA256,
		quiet:               opts.Quiet,
		reporter:            opts.StatusReporter,
		downloadID:          opts.DownloadID,
		client:              client,
		lastReportedTime:    time.Now(),
		maxConnectionFailures: 10, // Max failures before pausing
	}
}

// Helper function to check if download is paused
func (d *HTTPDownloader) isPaused() bool {
	d.pauseMutex.Lock()
	defer d.pauseMutex.Unlock()
	return d.paused
}

// Helper function to pause download with reason
func (d *HTTPDownloader) pauseWithReason(reason string) {
	d.pauseMutex.Lock()
	d.paused = true
	d.pauseReason = reason
	d.pauseMutex.Unlock()
	
	if d.reporter != nil {
		d.reporter.Report(map[string]interface{}{
			"type":    "http",
			"status":  "paused",
			"message": reason,
			"pause_reason": reason,
		})
	}
}

// Helper function to check if error is a connection error
func isConnectionError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	return strings.Contains(errStr, "connection reset") ||
		strings.Contains(errStr, "connection refused") ||
		strings.Contains(errStr, "connection timed out") ||
		strings.Contains(errStr, "timeout") ||
		strings.Contains(errStr, "no such host") ||
		strings.Contains(errStr, "network is unreachable") ||
		strings.Contains(errStr, "i/o timeout")
}

// Helper function to handle connection failure with retry logic
func (d *HTTPDownloader) handleConnectionFailure(err error) error {
	if !isConnectionError(err) {
		return err
	}
	
	d.connectionFailureMutex.Lock()
	d.connectionFailures++
	lastFailure := d.lastFailureTime
	d.lastFailureTime = time.Now()
	failures := d.connectionFailures
	d.connectionFailureMutex.Unlock()
	
	// If we've had too many failures, pause the download
	if failures >= d.maxConnectionFailures {
		reason := fmt.Sprintf("Connection lost: %s. Paused after %d failures. Please check your connection and resume manually.", err.Error(), failures)
		d.pauseWithReason(reason)
		return fmt.Errorf("connection lost: paused after %d failures", failures)
	}
	
	// Exponential backoff: wait longer between retries
	// Reset counter if last failure was more than 30 seconds ago (connection recovered)
	if !lastFailure.IsZero() && time.Since(lastFailure) > 30*time.Second {
		d.connectionFailureMutex.Lock()
		d.connectionFailures = 1 // Reset to 1 (current failure)
		d.connectionFailureMutex.Unlock()
	}
	
	// Exponential backoff: 1s, 2s, 4s, 8s, etc., max 30s
	backoff := time.Duration(1<<uint(failures-1)) * time.Second
	if backoff > 30*time.Second {
		backoff = 30 * time.Second
	}
	
	// Report retrying status
	if d.reporter != nil {
		d.reporter.Report(map[string]interface{}{
			"type":    "http",
			"status":  "downloading",
			"message": fmt.Sprintf("Connection lost, retrying in %v... (attempt %d/%d)", backoff, failures, d.maxConnectionFailures),
		})
	}
	
	time.Sleep(backoff)
	return err // Return error to trigger retry
}

// Helper function to reset connection failure counter on success
func (d *HTTPDownloader) resetConnectionFailures() {
	d.connectionFailureMutex.Lock()
	d.connectionFailures = 0
	d.connectionFailureMutex.Unlock()
}

func (d *HTTPDownloader) Download() error {
	// Check if final file already exists and verify it
	if info, err := os.Stat(d.outPath); err == nil {
		existingSize := info.Size()
		
		if d.reporter != nil {
			d.reporter.Report(map[string]interface{}{
				"type":          "http",
				"status":        "verifying",
				"progress":      0.0,
				"verify_status": "checking_existing_file",
				"downloaded":    existingSize,
			})
		}
		
		// Verify existing file if SHA256 is provided
		if d.sha256 != "" {
			if d.reporter != nil {
				d.reporter.Report(map[string]interface{}{
					"type":          "http",
					"status":        "verifying",
					"progress":      0.0,
					"verify_status": "checksum_verifying",
				})
			}
			if err := d.verifySHA256(); err == nil {
				// File exists and is valid
				if d.reporter != nil {
					d.reporter.Report(map[string]interface{}{
						"type":          "http",
						"status":        "completed",
						"progress":      1.0,
						"downloaded":    existingSize,
						"total":         existingSize,
						"verify_status": "checksum_verified",
						"verified":      true,
					})
				}
				return nil
			}
			// SHA256 mismatch - file is corrupted, remove it
			os.Remove(d.outPath)
		} else {
			// No SHA256 provided, but file exists - assume it's complete
			// We'll verify size after probe
		}
	}
	
	// Create temp directory for chunks (hidden folder in destination directory)
	destDir := filepath.Dir(d.outPath)
	fileName := filepath.Base(d.outPath)
	tempDirName := fmt.Sprintf(".accelara-temp-%s", fileName)
	d.tempDir = filepath.Join(destDir, tempDirName)
	
	// Create temp directory
	if err := os.MkdirAll(d.tempDir, 0755); err != nil {
		return fmt.Errorf("failed to create temp directory: %s", err)
	}
	
	// Ensure temp directory is cleaned up on error
	defer func() {
		// Only remove if download failed (check if final file exists)
		if _, err := os.Stat(d.outPath); os.IsNotExist(err) {
			os.RemoveAll(d.tempDir)
		}
	}()

	if err := d.probe(); err != nil {
		return err
	}
	
	// After probe, check if existing file size matches expected size
	if info, err := os.Stat(d.outPath); err == nil && d.totalSize > 0 {
		if info.Size() == d.totalSize {
			// File exists and size matches - verify SHA256 if provided
			if d.sha256 != "" {
				if d.reporter != nil {
					d.reporter.Report(map[string]interface{}{
						"type":          "http",
						"status":        "verifying",
						"progress":      1.0,
						"verify_status": "checksum_verifying",
					})
				}
				if err := d.verifySHA256(); err == nil {
					// File is complete and valid
					if d.reporter != nil {
						d.reporter.Report(map[string]interface{}{
							"type":          "http",
							"status":        "completed",
							"progress":      1.0,
							"downloaded":    d.totalSize,
							"total":         d.totalSize,
							"verify_status": "checksum_verified",
							"verified":      true,
						})
					}
					return nil
				}
				// SHA256 mismatch - remove corrupted file
				os.Remove(d.outPath)
			} else {
				// No SHA256, but size matches - assume complete
				if d.reporter != nil {
					d.reporter.Report(map[string]interface{}{
						"type":          "http",
						"status":        "completed",
						"progress":      1.0,
						"downloaded":    d.totalSize,
						"total":         d.totalSize,
						"verify_status": "size_verified",
						"verified":      true,
					})
				}
				return nil
			}
		}
	}

	if d.reporter != nil {
		d.reporter.Report(map[string]interface{}{
			"type":          "http",
			"status":        "downloading",
			"progress":      0.0,
			"total":         d.totalSize,
			"accept_ranges": d.acceptRanges,
		})
	}

	if !d.acceptRanges || d.totalSize == 0 {
		return d.downloadSingle()
	}

	return d.downloadSegmented()
}

func (d *HTTPDownloader) probe() error {
	req, err := http.NewRequest("HEAD", d.sourceURL, nil)
	if err != nil {
		return err
	}

	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.Header.Get("Content-Length") != "" {
		d.totalSize, _ = strconv.ParseInt(resp.Header.Get("Content-Length"), 10, 64)
	}
	d.acceptRanges = resp.Header.Get("Accept-Ranges") == "bytes"

	if d.totalSize == 0 {
		req, _ := http.NewRequest("GET", d.sourceURL, nil)
		req.Header.Set("Range", "bytes=0-0")
		resp, err := d.client.Do(req)
		if err == nil {
			if resp.Header.Get("Content-Length") != "" {
				d.totalSize, _ = strconv.ParseInt(resp.Header.Get("Content-Length"), 10, 64)
			}
			resp.Body.Close()
		}
	}

	if d.totalSize > 0 && d.acceptRanges {
		// Limit chunks to concurrency (max 8, min 1)
		maxChunks := d.concurrency
		if maxChunks > 8 {
			maxChunks = 8
		}
		if maxChunks < 1 {
			maxChunks = 1
		}
		
		// Calculate chunk size based on max chunks
		chunkSize := (d.totalSize + int64(maxChunks) - 1) / int64(maxChunks)
		if chunkSize < d.chunkSize {
			chunkSize = d.chunkSize
		}
		
		count := (d.totalSize + chunkSize - 1) / chunkSize
		if count > int64(maxChunks) {
			count = int64(maxChunks)
		}
		
		d.chunks = make([]chunk, count)
		d.chunkProgress = make([]int64, count)
		for i := int64(0); i < count; i++ {
			start := i * chunkSize
			end := start + chunkSize - 1
			if end >= d.totalSize {
				end = d.totalSize - 1
			}
			d.chunks[i] = chunk{start: start, end: end}
			d.chunkProgress[i] = 0
		}
	}

	return nil
}

func (d *HTTPDownloader) downloadSingle() error {
	// Use temp directory for single file download too
	tempPath := filepath.Join(d.tempDir, filepath.Base(d.outPath))
	file, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer file.Close()

	req, _ := http.NewRequest("GET", d.sourceURL, nil)
	resp, err := d.client.Do(req)
	if err != nil {
		// Handle connection errors with retry logic
		if isConnectionError(err) {
			return d.handleConnectionFailure(err)
		}
		return err
	}
	defer resp.Body.Close()

	buf := make([]byte, 65536)
	lastUpdate := time.Now()
	lastDownloaded := int64(0)

	for {
		// Check if paused
		if d.isPaused() {
			return fmt.Errorf("download paused: %s", d.pauseReason)
		}
		
		n, err := resp.Body.Read(buf)
		if n > 0 {
			file.Write(buf[:n])
			d.downloadedMutex.Lock()
			d.downloaded += int64(n)
			downloaded := d.downloaded
			d.downloadedMutex.Unlock()
			
			// Reset connection failures on successful read
			d.resetConnectionFailures()

			now := time.Now()
			if now.Sub(lastUpdate) > 100*time.Millisecond && d.reporter != nil {
				elapsed := now.Sub(lastUpdate).Seconds()
				speed := float64(0)
				if elapsed > 0 {
					speed = float64(downloaded-lastDownloaded) / elapsed
				}
				// Ensure progress never exceeds 1.0
				progress := float64(downloaded) / float64(d.totalSize)
				if progress > 1.0 {
					progress = 1.0
				}
				
				// Calculate ETA based on current speed
				var eta float64 = 0
				if speed > 0 && d.totalSize > 0 && downloaded < d.totalSize {
					remaining := d.totalSize - downloaded
					eta = float64(remaining) / speed
				}

				reportData := map[string]interface{}{
					"type":          "http",
					"status":        "downloading",
					"progress":      progress,
					"downloaded":    downloaded,
					"total":         d.totalSize,
					"speed":         int64(speed),
					"download_rate": int64(speed),
					"eta":           eta,
				}
				
				// Add SHA256 for state persistence if available
				if d.sha256 != "" {
					reportData["sha256"] = d.sha256
				}
				
				d.reporter.Report(reportData)
				lastUpdate = now
				lastDownloaded = downloaded
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			// Handle connection errors - pause download
			if isConnectionError(err) {
				retryErr := d.handleConnectionFailure(err)
				if retryErr != nil && strings.Contains(retryErr.Error(), "paused") {
					// Download was paused - don't complete, return error
					return retryErr
				}
				// For single connection, we can't easily retry mid-stream
				// Pause and let user resume
				reason := fmt.Sprintf("Connection lost during download: %s. Please resume manually.", err.Error())
				d.pauseWithReason(reason)
				return fmt.Errorf("connection lost: %s", err.Error())
			}
			return err
		}
	}
	
	// Check if paused before completing
	if d.isPaused() {
		return fmt.Errorf("download paused: %s", d.pauseReason)
	}

	// Move from temp to final destination
	if err := os.Rename(tempPath, d.outPath); err != nil {
		return fmt.Errorf("failed to move file to destination: %s", err)
	}
	
	// Verify SHA256 if provided
	if d.sha256 != "" {
		if d.reporter != nil {
			d.reporter.Report(map[string]interface{}{
				"type":          "http",
				"status":        "verifying",
				"progress":      1.0,
				"verify_status": "checksum_verifying",
			})
		}
		if err := d.verifySHA256(); err != nil {
			// Remove corrupted file
			os.Remove(d.outPath)
			return err
		}
		if d.reporter != nil {
			d.reporter.Report(map[string]interface{}{
				"type":          "http",
				"status":        "verifying",
				"progress":      1.0,
				"verify_status": "checksum_verified",
			})
		}
	}
	
	// Clean up temp directory
	os.RemoveAll(d.tempDir)
	
	return nil
}

func (d *HTTPDownloader) downloadSegmented() error {
	sem := make(chan struct{}, d.concurrency)
	var wg sync.WaitGroup
	failedChunks := make(map[int]error)
	failedMutex := sync.Mutex{}

	for i, ch := range d.chunks {
		wg.Add(1)
		go func(idx int, c chunk) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			for attempt := 0; attempt <= d.retries; attempt++ {
				// Check if paused
				if d.isPaused() {
					failedMutex.Lock()
					failedChunks[idx] = fmt.Errorf("download paused: %s", d.pauseReason)
					failedMutex.Unlock()
					return
				}
				
				err := d.downloadChunk(idx, c)
				if err == nil {
					// Reset connection failures on success
					d.resetConnectionFailures()
					return
				}
				
				// Check if this is a multi-connection rejection
				errStr := err.Error()
				if strings.Contains(errStr, "multi-connection may not be allowed") || 
				   strings.Contains(errStr, "range requests may not be supported") {
					failedMutex.Lock()
					failedChunks[idx] = err
					failedMutex.Unlock()
					
					// Mark as failed and break retry loop
					d.multiConnectionMutex.Lock()
					d.multiConnectionFailed = true
					d.multiConnectionMutex.Unlock()
					return
				}
				
				// Handle connection errors with retry logic
				if isConnectionError(err) {
					retryErr := d.handleConnectionFailure(err)
					if retryErr != nil && strings.Contains(retryErr.Error(), "paused") {
						// Download was paused due to too many failures
						failedMutex.Lock()
						failedChunks[idx] = retryErr
						failedMutex.Unlock()
						return
					}
					// Continue retry loop
					continue
				}
				
				if attempt < d.retries {
					time.Sleep(time.Duration(attempt+1) * 500 * time.Millisecond)
				} else {
					failedMutex.Lock()
					failedChunks[idx] = err
					failedMutex.Unlock()
				}
			}
		}(i, ch)
	}

	wg.Wait()
	
	// Check if multi-connection failed and fall back to single connection
	d.multiConnectionMutex.Lock()
	shouldFallback := d.multiConnectionFailed && len(failedChunks) > 0
	d.multiConnectionMutex.Unlock()
	
	if shouldFallback {
		// Report fallback to user
		if d.reporter != nil {
			d.reporter.Report(map[string]interface{}{
				"type":    "http",
				"status":  "downloading",
				"message": "Server disallows multiple connections, falling back to single connection",
			})
		}
		
		// Clean up partial chunks before falling back to single connection
		fileName := filepath.Base(d.outPath)
		for _, c := range d.chunks {
			partPath := filepath.Join(d.tempDir, fmt.Sprintf("%s.part.%d.%d", fileName, c.start, c.end))
			os.Remove(partPath) // Ignore errors - file may not exist
		}
		
		// Reset progress tracking
		d.chunkMutex.Lock()
		d.chunkProgress = nil
		d.chunks = nil
		d.chunkMutex.Unlock()
		
		// Fall back to single connection mode
		return d.downloadSingle()
	}

	// Verify all chunks are complete before merging
	d.chunkMutex.Lock()
	allChunksComplete := true
	totalChunkDownloaded := int64(0)
	var incompleteChunks []int
	for i := range d.chunks {
		chunkSize := d.chunks[i].end - d.chunks[i].start + 1
		if d.chunkProgress[i] < chunkSize {
			allChunksComplete = false
			incompleteChunks = append(incompleteChunks, i)
		}
		totalChunkDownloaded += d.chunkProgress[i]
	}
	d.chunkMutex.Unlock()
	
	// Update total downloaded from chunk progress
	d.downloadedMutex.Lock()
	d.downloaded = totalChunkDownloaded
	d.downloadedMutex.Unlock()
	
	if !allChunksComplete {
		return fmt.Errorf("not all chunks completed: chunks %v incomplete, downloaded %d of %d bytes", incompleteChunks, totalChunkDownloaded, d.totalSize)
	}
	
	// Verify total downloaded matches expected (allow small rounding differences)
	if totalChunkDownloaded < d.totalSize-1024 || totalChunkDownloaded > d.totalSize+1024 {
		return fmt.Errorf("download size mismatch: expected %d bytes, downloaded %d bytes", d.totalSize, totalChunkDownloaded)
	}

	if d.reporter != nil {
		d.reporter.Report(map[string]interface{}{
			"type":              "http",
			"status":            "verifying",
			"progress":          1.0,
			"verify_status":     "chunks_verified",
			"downloaded":        d.downloaded,
			"total":             d.totalSize,
			"chunk_total_size":  totalChunkDownloaded,
		})
	}

	if err := d.assemble(); err != nil {
		return err
	}

	if d.sha256 != "" {
		if d.reporter != nil {
			d.reporter.Report(map[string]interface{}{
				"type":          "http",
				"status":        "verifying",
				"progress":      1.0,
				"verify_status": "checksum_verifying",
			})
		}
		if err := d.verifySHA256(); err != nil {
			return err
		}
		if d.reporter != nil {
			d.reporter.Report(map[string]interface{}{
				"type":          "http",
				"status":        "verifying",
				"progress":      1.0,
				"verify_status": "checksum_verified",
			})
		}
	}

	reportData := map[string]interface{}{
		"type":       "http",
		"status":     "completed",
		"progress":   1.0,
		"downloaded": d.downloaded,
		"total":      d.totalSize,
		"verified":   true,
	}
	
	// Add SHA256 for state persistence if available
	if d.sha256 != "" {
		reportData["sha256"] = d.sha256
		reportData["verify_status"] = "checksum_verified"
	} else {
		reportData["verify_status"] = "size_verified"
	}
	
	if d.reporter != nil {
		d.reporter.Report(reportData)
	}

	return nil
}

func (d *HTTPDownloader) downloadChunk(idx int, c chunk) error {
	// Store chunks in temp directory
	fileName := filepath.Base(d.outPath)
	partPath := filepath.Join(d.tempDir, fmt.Sprintf("%s.part.%d.%d", fileName, c.start, c.end))
	expectedChunkSize := c.end - c.start + 1

	// Check if chunk already exists and resume from where it left off
	var file *os.File
	var err error
	var start int64 = c.start
	var chunkDownloaded int64 = 0
	
	if info, err := os.Stat(partPath); err == nil {
		if info.Size() >= expectedChunkSize {
			// Chunk is already complete, update progress and return
			d.chunkMutex.Lock()
			d.chunkProgress[idx] = expectedChunkSize
			// Update total downloaded from all chunk progress
			totalDownloaded := int64(0)
			for i := range d.chunkProgress {
				totalDownloaded += d.chunkProgress[i]
			}
			d.chunkMutex.Unlock()
			
			d.downloadedMutex.Lock()
			d.downloaded = totalDownloaded
			d.downloadedMutex.Unlock()
			return nil
		}
		// Chunk exists but is incomplete - resume from where it left off
		existingSize := info.Size()
		chunkDownloaded = existingSize
		start = c.start + existingSize
		
		// Open file in append mode to continue downloading
		file, err = os.OpenFile(partPath, os.O_WRONLY|os.O_APPEND, 0644)
		if err != nil {
			// If we can't append, remove and start fresh
			os.Remove(partPath)
			file, err = os.OpenFile(partPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
			if err != nil {
				return err
			}
			start = c.start
			chunkDownloaded = 0
		}
	} else {
		// Chunk doesn't exist, create new file
		file, err = os.OpenFile(partPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if err != nil {
			return err
		}
	}
	defer file.Close()

	req, _ := http.NewRequest("GET", d.sourceURL, nil)
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, c.end))

	resp, err := d.client.Do(req)
	if err != nil {
		// Check if it's a connection error that might indicate multi-connection issues
		errStr := err.Error()
		if (strings.Contains(errStr, "connection reset") || 
		    strings.Contains(errStr, "connection refused") ||
		    strings.Contains(errStr, "timeout")) && d.concurrency > 1 {
			// Multiple connection errors might indicate server doesn't allow it
			d.multiConnectionMutex.Lock()
			d.multiConnectionFailed = true
			d.multiConnectionMutex.Unlock()
		}
		// Handle connection errors with retry logic
		if isConnectionError(err) {
			return d.handleConnectionFailure(err)
		}
		return err
	}
	defer resp.Body.Close()

	// Check if server disallows multiple connections
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests || 
	   resp.StatusCode == http.StatusServiceUnavailable || resp.StatusCode == http.StatusBadRequest {
		// Server rejected the request - likely doesn't allow multiple connections
		d.multiConnectionMutex.Lock()
		d.multiConnectionFailed = true
		d.multiConnectionMutex.Unlock()
		return fmt.Errorf("server rejected request (status %d): multi-connection may not be allowed", resp.StatusCode)
	}
	
	// If we requested a range but got 200 OK instead of 206 Partial Content, server may not support ranges
	if resp.StatusCode == http.StatusOK && start > c.start {
		// We requested a range but got full content - server doesn't support ranges properly
		d.multiConnectionMutex.Lock()
		d.multiConnectionFailed = true
		d.multiConnectionMutex.Unlock()
		return fmt.Errorf("server returned 200 OK instead of 206 Partial Content: range requests may not be supported")
	}
	
	if resp.StatusCode != http.StatusPartialContent && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	buf := make([]byte, 65536)
	lastUpdate := time.Now()
	
	// Update progress with existing chunk size if resuming
	if chunkDownloaded > 0 {
		d.chunkMutex.Lock()
		d.chunkProgress[idx] = chunkDownloaded
		d.chunkMutex.Unlock()
	}
	
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			written, writeErr := file.Write(buf[:n])
			if writeErr != nil {
				return writeErr
			}
			
			chunkDownloaded += int64(written)
			
			d.chunkMutex.Lock()
			d.chunkProgress[idx] = chunkDownloaded
			// Calculate total downloaded from all chunk progress to avoid double-counting
			totalDownloaded := int64(0)
			for i := range d.chunkProgress {
				totalDownloaded += d.chunkProgress[i]
			}
			chunkProgress := make([]map[string]interface{}, len(d.chunks))
			for i := range d.chunks {
				chunkSize := d.chunks[i].end - d.chunks[i].start + 1
				chunkProgress[i] = map[string]interface{}{
					"index":      i,
					"start":      d.chunks[i].start,
					"end":        d.chunks[i].end,
					"progress":   float64(d.chunkProgress[i]) / float64(chunkSize),
					"downloaded": d.chunkProgress[i],
					"total":      chunkSize,
				}
			}
			d.chunkMutex.Unlock()
			
			// Update total downloaded from chunk progress
			d.downloadedMutex.Lock()
			d.downloaded = totalDownloaded
			downloaded := d.downloaded
			d.downloadedMutex.Unlock()

			if d.reporter != nil && time.Since(lastUpdate) > 200*time.Millisecond {
				// Ensure progress never exceeds 1.0
				progress := float64(downloaded) / float64(d.totalSize)
				if progress > 1.0 {
					progress = 1.0
				}
				
				// Calculate speed from total downloaded using global tracking
				// This ensures consistent speed calculation across all concurrent chunks
				d.speedMutex.Lock()
				now := time.Now()
				elapsed := now.Sub(d.lastReportedTime).Seconds()
				speed := int64(0)
				if elapsed > 0 && downloaded >= d.lastReportedDownloaded {
					speed = int64(float64(downloaded-d.lastReportedDownloaded) / elapsed)
				}
				// Update global tracking for next calculation
				d.lastReportedDownloaded = downloaded
				d.lastReportedTime = now
				d.speedMutex.Unlock()
				
				// Calculate ETA based on current speed
				var eta float64 = 0
				if speed > 0 && d.totalSize > 0 && downloaded < d.totalSize {
					remaining := d.totalSize - downloaded
					eta = float64(remaining) / float64(speed)
				}
				
				reportData := map[string]interface{}{
					"type":          "http",
					"status":        "downloading",
					"progress":      progress,
					"downloaded":    downloaded,
					"total":         d.totalSize,
					"speed":         speed,
					"download_rate": speed,
					"chunk_progress": chunkProgress,
					"eta":           eta,
					"chunk_count":   len(d.chunks),
				}
				
				// Add SHA256 for state persistence if available
				if d.sha256 != "" {
					reportData["sha256"] = d.sha256
				}
				
				d.reporter.Report(reportData)
				lastUpdate = time.Now()
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}

	// Verify chunk is complete
	if chunkDownloaded != expectedChunkSize {
		return fmt.Errorf("chunk %d incomplete: downloaded %d of %d bytes", idx, chunkDownloaded, expectedChunkSize)
	}

	return nil
}

func (d *HTTPDownloader) assemble() error {
	if d.reporter != nil {
		d.reporter.Report(map[string]interface{}{
			"type":     "http",
			"status":   "merging",
			"progress": 1.0,
		})
	}
	
	// Create merged file in temp directory first
	fileName := filepath.Base(d.outPath)
	tempMergedPath := filepath.Join(d.tempDir, fileName)
	outFile, err := os.Create(tempMergedPath)
	if err != nil {
		return err
	}
	defer outFile.Close()

	totalChunks := len(d.chunks)
	totalMerged := int64(0)
	
	// First, verify all chunk files exist and get their sizes
	chunkSizes := make([]int64, totalChunks)
	totalChunkSize := int64(0)
	for i, c := range d.chunks {
		partPath := filepath.Join(d.tempDir, fmt.Sprintf("%s.part.%d.%d", fileName, c.start, c.end))
		partFile, err := os.Open(partPath)
		if err != nil {
			return fmt.Errorf("chunk file missing: %s", err)
		}
		stat, err := partFile.Stat()
		if err != nil {
			partFile.Close()
			return fmt.Errorf("failed to stat chunk file: %s", err)
		}
		chunkSizes[i] = stat.Size()
		totalChunkSize += stat.Size()
		partFile.Close()
	}
	
	// Verify total chunk size matches expected
	expectedChunkSize := int64(0)
	for _, c := range d.chunks {
		expectedChunkSize += (c.end - c.start + 1)
	}
	
	if totalChunkSize != expectedChunkSize {
		return fmt.Errorf("chunk size mismatch: expected %d bytes, got %d bytes", expectedChunkSize, totalChunkSize)
	}
	
	// Report verification status
	if d.reporter != nil {
		d.reporter.Report(map[string]interface{}{
			"type":              "http",
			"status":            "merging",
			"progress":          1.0,
			"verification":      "verified",
			"chunk_total_size":  totalChunkSize,
			"expected_size":     expectedChunkSize,
		})
	}
	
	// Now merge the chunks in order
	for i, c := range d.chunks {
		partPath := filepath.Join(d.tempDir, fmt.Sprintf("%s.part.%d.%d", fileName, c.start, c.end))
		partFile, err := os.Open(partPath)
		if err != nil {
			return fmt.Errorf("failed to open chunk %d file: %s", i, err)
		}
		
		// Verify chunk file size before merging
		partInfo, err := partFile.Stat()
		if err != nil {
			partFile.Close()
			return fmt.Errorf("failed to stat chunk %d file: %s", i, err)
		}
		expectedSize := c.end - c.start + 1
		if partInfo.Size() != expectedSize {
			partFile.Close()
			return fmt.Errorf("chunk %d size mismatch: expected %d bytes, got %d bytes", i, expectedSize, partInfo.Size())
		}
		
		// Report merging progress
		if d.reporter != nil {
			mergeProgress := float64(i+1) / float64(totalChunks)
			bytesWritten, _ := outFile.Seek(0, io.SeekCurrent)
			d.reporter.Report(map[string]interface{}{
				"type":           "http",
				"status":         "merging",
				"progress":       1.0,
				"merge_progress": mergeProgress,
				"merge_chunk":     i + 1,
				"merge_total":    totalChunks,
				"merged_bytes":   bytesWritten,
				"total_bytes":    totalChunkSize,
			})
		}
		
		copied, err := io.Copy(outFile, partFile)
		if err != nil {
			partFile.Close()
			return fmt.Errorf("failed to copy chunk %d: %s", i, err)
		}
		if copied != expectedSize {
			partFile.Close()
			return fmt.Errorf("chunk %d copy size mismatch: expected %d bytes, copied %d bytes", i, expectedSize, copied)
		}
		totalMerged += copied
		partFile.Close()
		
		// Remove chunk file after successful merge
		if err := os.Remove(partPath); err != nil {
			// Log but don't fail - chunk is already merged
			fmt.Printf("Warning: failed to remove chunk file %s: %s\n", partPath, err)
		}
	}
	
	// Close the file before moving
	outFile.Close()
	
	// Verify final file size
	outFileInfo, err := os.Stat(tempMergedPath)
	if err != nil {
		return fmt.Errorf("failed to stat merged file: %s", err)
	}
	
	finalSize := outFileInfo.Size()
	if finalSize != d.totalSize {
		return fmt.Errorf("file size mismatch: expected %d bytes, got %d bytes", d.totalSize, finalSize)
	}
	
	if totalMerged != d.totalSize {
		return fmt.Errorf("merged size mismatch: expected %d bytes, merged %d bytes", d.totalSize, totalMerged)
	}

	if d.reporter != nil {
		d.reporter.Report(map[string]interface{}{
			"type":          "http",
			"status":        "verifying",
			"progress":      1.0,
			"verify_status": "size_verified",
			"file_size":     finalSize,
			"expected_size": d.totalSize,
		})
	}

	// Move merged file from temp to final destination
	if err := os.Rename(tempMergedPath, d.outPath); err != nil {
		return fmt.Errorf("failed to move merged file to destination: %s", err)
	}
	
	// Clean up temp directory and all chunk files
	os.RemoveAll(d.tempDir)

	return nil
}

func (d *HTTPDownloader) verifySHA256() error {
	file, err := os.Open(d.outPath)
	if err != nil {
		return err
	}
	defer file.Close()

	hash := sha256.New()
	io.Copy(hash, file)
	computed := hex.EncodeToString(hash.Sum(nil))

	if strings.ToLower(computed) != strings.ToLower(d.sha256) {
		return fmt.Errorf("SHA256 mismatch: expected %s, got %s", d.sha256, computed)
	}

	return nil
}
