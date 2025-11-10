package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
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
		Quiet:          true,
		StatusReporter: reporter,
		DownloadID:     *downloadID,
	}

	if utils.IsTorrentLike(*source) {
		dl := downloader.NewTorrentDownloader(*source, absOutPath, opts)
		if err := dl.Download(); err != nil {
			reporter.Report(map[string]interface{}{
				"type":    "error",
				"status":  "error",
				"message": err.Error(),
			})
			os.Exit(1)
		}
	} else {
		outFile := absOutPath
		if info, err := os.Stat(absOutPath); err == nil && info.IsDir() {
			outFile = filepath.Join(absOutPath, "download.tmp")
		}

		opts.DownloadID = *downloadID
		dl := downloader.NewHTTPDownloader(*source, outFile, opts)
		if err := dl.Download(); err != nil {
			reporter.Report(map[string]interface{}{
				"type":    "error",
				"status":  "error",
				"message": err.Error(),
			})
			os.Exit(1)
		}
	}
}
