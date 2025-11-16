package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/accelara/clidm/internal/downloader"
	"github.com/accelara/clidm/internal/utils"
)

type StatusReporter struct {
	downloadID string
	lastUpdate time.Time
}

func (sr *StatusReporter) Report(status map[string]interface{}) {
	now := time.Now()
	if now.Sub(sr.lastUpdate) < 100*time.Millisecond {
		return
	}
	sr.lastUpdate = now

	output := map[string]interface{}{
		"download_id": sr.downloadID,
		"timestamp":   now.Unix(),
	}
	for k, v := range status {
		output[k] = v
	}

	data, _ := json.Marshal(output)
	fmt.Println(string(data))
}

func main() {
	var (
		source         = flag.String("source", "", "Source URL or torrent")
		output         = flag.String("output", "", "Output path")
		downloadID     = flag.String("download-id", "", "Download ID")
		connections    = flag.Int("concurrency", 8, "Number of concurrent connections")
		chunkSize      = flag.String("chunk-size", "4MB", "Chunk size")
		limit          = flag.String("limit", "", "Rate limit")
		btUploadLimit  = flag.String("bt-upload-limit", "", "BT upload limit")
		btSequential   = flag.Bool("bt-sequential", false, "Sequential mode")
		btKeepSeeding  = flag.Bool("bt-keep-seeding", false, "Keep seeding after download completes")
		btPort         = flag.Int("bt-port", 0, "BitTorrent listen port (0 = use default/auto)")
		connectTimeout = flag.Int("connect-timeout", 15, "Connect timeout")
		readTimeout    = flag.Int("read-timeout", 60, "Read timeout")
		retries        = flag.Int("retries", 5, "Retries")
		sha256         = flag.String("sha256", "", "SHA256 hash")
		inspect        = flag.Bool("inspect", false, "Inspect torrent/metadata only")
		httpInfo       = flag.Bool("http-info", false, "Get HTTP file info only")
		speedTest      = flag.Bool("speedtest", false, "Run speed test")
		testType       = flag.String("test-type", "full", "Speed test type: full, latency, download, upload")
	)

	flag.Parse()

	// Handle speed test mode
	if *speedTest {
		// Pass test type to runSpeedTest via environment or modify runSpeedTest to accept it
		// For now, we'll modify runSpeedTest to read from flag
		runSpeedTestWithType(*testType)
		return
	}

	// Handle inspect mode
	if *inspect {
		inspectTorrent()
		return
	}

	// Handle HTTP info mode
	if *httpInfo {
		getHTTPInfo()
		return
	}

	if *source == "" || *output == "" || *downloadID == "" {
		fmt.Fprintf(os.Stderr, "Error: source, output, and download-id are required\n")
		os.Exit(1)
	}

	reporter := &StatusReporter{downloadID: *downloadID}

	chunkSizeBytes, _ := utils.ParseBytes(*chunkSize)
	var limitBytes int64
	if *limit != "" {
		limitBytes, _ = utils.ParseBytes(*limit)
	}
	var btUploadLimitBytes int64
	if *btUploadLimit != "" {
		btUploadLimitBytes, _ = utils.ParseBytes(*btUploadLimit)
	}

	absOutPath, _ := filepath.Abs(*output)

	// Set up signal handling for graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	opts := downloader.Options{
		Connections:    *connections,
		ChunkSize:      chunkSizeBytes,
		RateLimit:      limitBytes,
		Retries:        *retries,
		ConnectTimeout: *connectTimeout,
		ReadTimeout:    *readTimeout,
		SHA256:         *sha256,
		BTUploadLimit:  btUploadLimitBytes,
		BTSequential:   *btSequential,
		BTKeepSeeding:  *btKeepSeeding,
		BTPort:         *btPort,
		Quiet:          true,
		StatusReporter: reporter,
		DownloadID:     *downloadID,
		Context:        ctx,
	}

	// Channel to receive OS signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)

	// Goroutine to handle shutdown signals
	go func() {
		sig := <-sigChan
		fmt.Fprintf(os.Stderr, "\nReceived signal: %v. Shutting down gracefully...\n", sig)
		reporter.Report(map[string]interface{}{
			"type":    "info",
			"status":  "stopping",
			"message": "Shutdown signal received, closing connections and releasing ports...",
		})
		cancel() // Cancel the context to stop downloads
	}()

	if utils.IsTorrentLike(*source) {
		dl := downloader.NewTorrentDownloader(*source, absOutPath, opts)
		// Run download in a goroutine so we can wait for signals
		errChan := make(chan error, 1)
		go func() {
			errChan <- dl.Download()
		}()

		select {
		case err := <-errChan:
			if err != nil {
				reporter.Report(map[string]interface{}{
					"type":    "error",
					"status":  "error",
					"message": err.Error(),
				})
				os.Exit(1)
			}
		case <-ctx.Done():
			// Context cancelled - shutdown signal received
			// The torrent client's defer Close() will handle cleanup
			reporter.Report(map[string]interface{}{
				"type":    "info",
				"status":  "stopped",
				"message": "Download stopped by user. Ports released.",
			})
			// Give a moment for cleanup
			time.Sleep(500 * time.Millisecond)
			os.Exit(0)
		}
	} else {
		// HTTP downloads are ALWAYS files (never directories)
		// Only use download.tmp if the path explicitly exists as a directory
		outFile := absOutPath
		if info, err := os.Stat(absOutPath); err == nil {
			// Path exists - only use download.tmp if it's actually a directory
			if info.IsDir() {
				outFile = filepath.Join(absOutPath, "download.tmp")
			}
			// If it exists and is a file, use it as-is
		}
		// If path doesn't exist, always treat it as a file path (HTTP downloads are files)

		opts.DownloadID = *downloadID
		dl := downloader.NewHTTPDownloader(*source, outFile, opts)
		// Run download in a goroutine so we can wait for signals
		errChan := make(chan error, 1)
		go func() {
			errChan <- dl.Download()
		}()

		select {
		case err := <-errChan:
			if err != nil {
				// Report error with full details before exiting
				reporter.Report(map[string]interface{}{
					"type":    "http",
					"status":  "error",
					"message": err.Error(),
					"error":   err.Error(),
				})
				// Also write to stderr for visibility in dev mode
				fmt.Fprintf(os.Stderr, "HTTP download error: %v\n", err)
				os.Exit(1)
			}
			// Success - report completion
			reporter.Report(map[string]interface{}{
				"type":    "http",
				"status":  "completed",
				"message": "Download completed successfully",
			})
		case <-ctx.Done():
			// Context cancelled - shutdown signal received
			reporter.Report(map[string]interface{}{
				"type":    "http",
				"status":  "stopped",
				"message": "Download stopped by user.",
			})
			fmt.Fprintf(os.Stderr, "Download stopped by user\n")
			os.Exit(0)
		}
	}
}
