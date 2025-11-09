package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/anacrolix/torrent/metainfo"
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
		fmt.Fprintf(os.Stderr, "Error: magnet links require metadata download, use inspect-torrent after adding to client\n")
		os.Exit(1)
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

	data, _ := json.Marshal(result)
	fmt.Println(string(data))
}

