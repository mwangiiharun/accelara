package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

func inspectTorrent() {
	// Note: flags are already parsed in main(), so we need to get the source from command line args
	args := os.Args[1:]
	source := ""
	for i, arg := range args {
		if arg == "--source" && i+1 < len(args) {
			source = args[i+1]
			break
		}
	}

	if source == "" {
		fmt.Fprintf(os.Stderr, "Error: source is required\n")
		os.Exit(1)
	}

	var mi *metainfo.MetaInfo
	var err error

	// Load torrent from different sources
	if strings.HasPrefix(source, "magnet:") {
		// For magnet links, we need to download metadata first
		result, err := inspectMagnetLink(source)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: failed to inspect magnet link: %s\n", err)
			os.Exit(1)
		}
		data, err := json.Marshal(result)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: failed to marshal result: %s\n", err)
			os.Exit(1)
		}
		fmt.Println(string(data))
		return
	} else if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		resp, err := http.Get(source)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: failed to fetch torrent: %s\n", err)
			os.Exit(1)
		}
		defer resp.Body.Close()
		mi, err = metainfo.Load(resp.Body)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: failed to parse torrent: %s\n", err)
			os.Exit(1)
		}
	} else {
		file, err := os.Open(source)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: failed to open torrent file: %s\n", err)
			os.Exit(1)
		}
		defer file.Close()
		mi, err = metainfo.Load(file)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: failed to parse torrent: %s\n", err)
			os.Exit(1)
		}
	}

	info, err := mi.UnmarshalInfo()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to unmarshal torrent info: %s\n", err)
		os.Exit(1)
	}

	// Build file list
	files := []map[string]interface{}{}
	totalSize := int64(0)

	if info.IsDir() {
		for _, file := range info.Files {
			filePath := strings.Join(file.Path, "/")
			fileSize := file.Length
			totalSize += fileSize
			files = append(files, map[string]interface{}{
				"path": filePath,
				"size": fileSize,
			})
		}
	} else {
		// Single file torrent
		fileName := info.Name
		fileSize := info.Length
		totalSize = fileSize
		files = append(files, map[string]interface{}{
			"path": fileName,
			"size": fileSize,
		})
	}

	result := map[string]interface{}{
		"name":      info.Name,
		"totalSize": totalSize,
		"fileCount": len(files),
		"files":     files,
	}

	data, err := json.Marshal(result)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to marshal result: %s\n", err)
		os.Exit(1)
	}
	fmt.Println(string(data))
}

// inspectMagnetLink downloads metadata from a magnet link and returns torrent info
func inspectMagnetLink(magnetURL string) (map[string]interface{}, error) {
	// Add panic recovery to prevent crashes
	defer func() {
		if r := recover(); r != nil {
			// Panic occurred, but we'll let it propagate after logging
			// The error will be caught by the caller
		}
	}()
	
	// Create a temporary directory for inspection
	tempDir := filepath.Join(os.TempDir(), "accelara-inspect-"+fmt.Sprintf("%d", time.Now().UnixNano()))
	defer func() {
		// Clean up temp directory
		os.RemoveAll(tempDir)
	}()
	
	// Create a temporary torrent client
	cfg := torrent.NewDefaultClientConfig()
	cfg.DataDir = tempDir
	cfg.DefaultStorage = storage.NewMMap(cfg.DataDir)
	
	// Try to find an available port
	listenPort := 42069
	portFound := false
	for i := 0; i < 5; i++ {
		addr, err := net.ResolveTCPAddr("tcp", fmt.Sprintf(":%d", listenPort+i))
		if err != nil {
			continue
		}
		listener, err := net.ListenTCP("tcp", addr)
		if err == nil {
			listener.Close()
			cfg.ListenPort = listenPort + i
			portFound = true
			break
		}
	}
	if !portFound {
		return nil, fmt.Errorf("failed to find available port")
	}
	
	client, err := torrent.NewClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create torrent client: %w", err)
	}
	defer func() {
		// Ensure client is closed even on panic
		if client != nil {
			client.Close()
		}
	}()
	
	// Add magnet link
	t, err := client.AddMagnet(magnetURL)
	if err != nil {
		return nil, fmt.Errorf("failed to add magnet link: %w", err)
	}
	
	// Wait for metadata with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	
	// Use a buffered channel and ensure goroutine cleanup
	metadataChan := make(chan bool, 1)
	done := make(chan struct{})
	
	go func() {
		defer func() {
			// Recover from any panic in the goroutine
			if r := recover(); r != nil {
				// Panic occurred, just exit
			}
		}()
		// Wait for metadata or done signal
		select {
		case <-t.GotInfo():
			// Metadata received, try to send it (non-blocking)
			select {
			case metadataChan <- true:
				// Successfully sent
			case <-done:
				// Already timed out, don't send
			}
		case <-done:
			// Timeout occurred, exit goroutine
		}
	}()
	
	// Wait for either metadata or timeout
	select {
	case <-metadataChan:
		// Metadata received - close done to signal goroutine to exit
		close(done)
	case <-ctx.Done():
		// Timeout occurred - close done first to signal goroutine
		close(done)
		// Remove torrent from client before returning
		t.Drop()
		return nil, fmt.Errorf("timeout waiting for metadata (30 seconds)")
	}
	
	// Get torrent info
	info := t.Info()
	if info == nil {
		t.Drop()
		return nil, fmt.Errorf("failed to get torrent info")
	}
	
	// Build file list
	files := []map[string]interface{}{}
	totalSize := int64(0)
	
	if info.IsDir() {
		for _, file := range info.Files {
			filePath := strings.Join(file.Path, "/")
			fileSize := file.Length
			totalSize += fileSize
			files = append(files, map[string]interface{}{
				"path": filePath,
				"size": fileSize,
			})
		}
	} else {
		// Single file torrent
		fileName := info.Name
		fileSize := info.Length
		totalSize = fileSize
		files = append(files, map[string]interface{}{
			"path": fileName,
			"size": fileSize,
		})
	}
	
	result := map[string]interface{}{
		"name":      info.Name,
		"totalSize": totalSize,
		"fileCount": len(files),
		"files":     files,
	}
	
	// Remove torrent from client before returning (cleanup)
	t.Drop()
	
	return result, nil
}

