package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

func getHTTPInfo() {
	// Note: flags are already parsed in main(), so we need to get the source from command line args
	// or use a different approach. Let's use os.Args directly.
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

	client := &http.Client{
		Timeout: 15 * 1000000000, // 15 seconds
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			// Follow redirects
			return nil
		},
	}

	// First, try HEAD request
	req, err := http.NewRequest("HEAD", source, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to create request: %s\n", err)
		os.Exit(1)
	}

	resp, err := client.Do(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to fetch: %s\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	// If we got redirected, use the final URL
	finalURL := resp.Request.URL.String()
	if finalURL != source {
		source = finalURL
	}

	// If response is HTML (likely a download page), try to find the actual download link
	contentType := resp.Header.Get("Content-Type")
	if strings.Contains(contentType, "text/html") {
		// Make a GET request to parse the HTML
		getReq, err := http.NewRequest("GET", source, nil)
		if err == nil {
			getResp, err := client.Do(getReq)
			if err == nil {
				defer getResp.Body.Close()
				body, err := io.ReadAll(getResp.Body)
				if err == nil {
					// Look for download links in the HTML
					htmlContent := string(body)

					// Try to find direct download links (common patterns)
					patterns := []*regexp.Regexp{
						regexp.MustCompile(`href=["']([^"']*\.(dmg|zip|tar\.gz|deb|rpm|exe|msi|pkg|app)[^"']*)["']`),
						regexp.MustCompile(`href=["']([^"']*download[^"']*\.(dmg|zip|tar\.gz|deb|rpm|exe|msi|pkg|app)[^"']*)["']`),
						regexp.MustCompile(`data-url=["']([^"']*\.(dmg|zip|tar\.gz|deb|rpm|exe|msi|pkg|app)[^"']*)["']`),
						regexp.MustCompile(`download.*href=["']([^"']*\.(dmg|zip|tar\.gz|deb|rpm|exe|msi|pkg|app)[^"']*)["']`),
					}

					for _, pattern := range patterns {
						matches := pattern.FindStringSubmatch(htmlContent)
						if len(matches) > 1 {
							downloadURL := matches[1]
							// Resolve relative URLs
							if strings.HasPrefix(downloadURL, "http://") || strings.HasPrefix(downloadURL, "https://") {
								source = downloadURL
							} else {
								baseURL, _ := url.Parse(source)
								relURL, _ := url.Parse(downloadURL)
								source = baseURL.ResolveReference(relURL).String()
							}
							// Retry with the found URL
							req, _ = http.NewRequest("HEAD", source, nil)
							resp, err = client.Do(req)
							if err == nil {
								break
							}
						}
					}
				}
			}
		}
	}

	// Extract filename from Content-Disposition header
	fileName := ""
	contentDisposition := resp.Header.Get("Content-Disposition")
	if contentDisposition != "" {
		// Try to match filename with quotes (single or double)
		reQuoted := regexp.MustCompile(`filename[^;=\n]*=['"]([^'"]*)['"]`)
		matches := reQuoted.FindStringSubmatch(contentDisposition)
		if len(matches) > 1 {
			fileName = matches[1]
		} else {
			// Try unquoted filename
			reUnquoted := regexp.MustCompile(`filename[^;=\n]*=([^;\n]+)`)
			matches = reUnquoted.FindStringSubmatch(contentDisposition)
			if len(matches) > 1 {
				fileName = strings.TrimSpace(matches[1])
			}
		}
	}

	// If no filename from header, extract from URL
	if fileName == "" {
		parsedURL, err := url.Parse(source)
		if err == nil {
			fileName = filepath.Base(parsedURL.Path)
			// Remove query parameters if any
			if idx := strings.Index(fileName, "?"); idx != -1 {
				fileName = fileName[:idx]
			}
		}
	}

	// If still no filename, use default
	if fileName == "" {
		fileName = "download"
	}

	totalSize := int64(0)
	if resp.Header.Get("Content-Length") != "" {
		fmt.Sscanf(resp.Header.Get("Content-Length"), "%d", &totalSize)
	}

	result := map[string]interface{}{
		"fileName":     fileName,
		"totalSize":    totalSize,
		"contentType":  resp.Header.Get("Content-Type"),
		"acceptRanges": resp.Header.Get("Accept-Ranges") == "bytes",
	}

	data, _ := json.Marshal(result)
	fmt.Println(string(data))
}
