package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/accelara/clidm/internal/downloader"
	"github.com/accelara/clidm/internal/utils"
)

func main() {
	var (
		source         = flag.String("source", "", "URL, magnet link, or .torrent file (required)")
		output         = flag.String("output", "", "Output file or directory")
		connections    = flag.Int("connections", 8, "Number of concurrent connections")
		chunkSize      = flag.String("chunk-size", "4MB", "Chunk size for segmented downloads")
		limit          = flag.String("limit", "", "Download rate limit")
		proxy          = flag.String("proxy", "", "HTTP/HTTPS proxy URL")
		retries        = flag.Int("retries", 5, "Number of retry attempts")
		connectTimeout = flag.Int("connect-timeout", 15, "Connection timeout in seconds")
		readTimeout    = flag.Int("read-timeout", 60, "Read timeout in seconds")
		sha256         = flag.String("sha256", "", "SHA256 hash for file verification")
		btUploadLimit  = flag.String("bt-upload-limit", "", "Upload rate limit for BitTorrent")
		btSequential   = flag.Bool("bt-sequential", false, "Download files sequentially")
		quiet          = flag.Bool("quiet", false, "Suppress progress output")
	)

	flag.Parse()

	if *source == "" {
		if len(flag.Args()) > 0 {
			*source = flag.Args()[0]
		} else {
			fmt.Fprintf(os.Stderr, "Error: source is required\n")
			os.Exit(1)
		}
	}

	outPath := *output
	if outPath == "" {
		outPath = "."
	}

	// Handle CTRL+C
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigChan
		fmt.Println("\nInterrupted. Resume supported.")
		os.Exit(0)
	}()

	chunkSizeBytes, err := utils.ParseBytes(*chunkSize)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing chunk-size: %v\n", err)
		os.Exit(1)
	}

	var limitBytes int64
	if *limit != "" {
		limitBytes, err = utils.ParseBytes(*limit)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error parsing limit: %v\n", err)
			os.Exit(1)
		}
	}

	var btUploadLimitBytes int64
	if *btUploadLimit != "" {
		btUploadLimitBytes, err = utils.ParseBytes(*btUploadLimit)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error parsing bt-upload-limit: %v\n", err)
			os.Exit(1)
		}
	}

	absOutPath, err := filepath.Abs(outPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error resolving output path: %v\n", err)
		os.Exit(1)
	}

	opts := downloader.Options{
		Connections:    *connections,
		ChunkSize:      chunkSizeBytes,
		RateLimit:      limitBytes,
		Proxy:          *proxy,
		Retries:        *retries,
		ConnectTimeout: *connectTimeout,
		ReadTimeout:    *readTimeout,
		SHA256:         *sha256,
		BTUploadLimit:  btUploadLimitBytes,
		BTSequential:   *btSequential,
		Quiet:          *quiet,
	}

	if utils.IsTorrentLike(*source) {
		dl := downloader.NewTorrentDownloader(*source, absOutPath, opts)
		if err := dl.Download(); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
	} else {
		outFile := absOutPath
		if info, err := os.Stat(absOutPath); err == nil && info.IsDir() {
			outFile = filepath.Join(absOutPath, "download.tmp")
		}

		dl := downloader.NewHTTPDownloader(*source, outFile, opts)
		if err := dl.Download(); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
	}
}
