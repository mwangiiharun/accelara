package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"
)

type SpeedTestResult struct {
	Type          string  `json:"type"`
	DownloadSpeed float64 `json:"download_speed,omitempty"` // bytes per second
	UploadSpeed   float64 `json:"upload_speed,omitempty"`   // bytes per second
	Latency       *LatencyResult `json:"latency,omitempty"`
	Progress      float64 `json:"progress,omitempty"`
	Status        string  `json:"status"`
}

type LatencyResult struct {
	Average   int `json:"average"`
	Min       int `json:"min"`
	Max       int `json:"max"`
	GooglePing int `json:"google_ping,omitempty"`
}

func runSpeedTestWithType(testType string) {
	if testType == "" {
		testType = "full"
	}

	switch testType {
	case "latency":
		testLatencyBackend()
	case "download":
		testDownloadSpeedBackend()
	case "upload":
		testUploadSpeedBackend()
	case "full":
		// Run all tests sequentially
		testLatencyBackend()
		testDownloadSpeedBackend()
		testUploadSpeedBackend()
	default:
		fmt.Fprintf(os.Stderr, "Error: invalid test type: %s\n", testType)
		os.Exit(1)
	}
}

// Keep runSpeedTest for backward compatibility
func runSpeedTest() {
	runSpeedTestWithType("full")
}

func testLatencyBackend() {
	times := []float64{}
	googleTimes := []float64{}
	testCount := 10
	googleURL := "https://www.google.com"
	otherURLs := []string{"https://www.cloudflare.com", "https://1.1.1.1"}

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	for i := 0; i < testCount; i++ {
		// Test Google specifically
		start := time.Now()
		req, err := http.NewRequest("HEAD", googleURL, nil)
		if err == nil {
			resp, err := client.Do(req)
			if err == nil {
				resp.Body.Close()
				elapsed := time.Since(start).Seconds() * 1000 // Convert to ms
				googleTimes = append(googleTimes, elapsed)
				times = append(times, elapsed)
			}
		}

		// Test other servers
		for _, url := range otherURLs {
			start := time.Now()
			req, err := http.NewRequest("HEAD", url, nil)
			if err == nil {
				resp, err := client.Do(req)
				if err == nil {
					resp.Body.Close()
					elapsed := time.Since(start).Seconds() * 1000
					times = append(times, elapsed)
					break
				}
			}
		}

		// Report progress and Google ping in real-time
		progress := float64(i+1) / float64(testCount) * 33.0
		result := SpeedTestResult{
			Type:     "latency",
			Progress: progress,
			Status:   "testing",
		}
		if len(googleTimes) > 0 {
			avgGoogle := 0.0
			for _, t := range googleTimes {
				avgGoogle += t
			}
			avgGoogle /= float64(len(googleTimes))
			result.Latency = &LatencyResult{
				GooglePing: int(avgGoogle),
			}
		}
		reportSpeedTestResult(result)

		time.Sleep(100 * time.Millisecond)
	}

	if len(times) > 0 {
		avg := 0.0
		min := times[0]
		max := times[0]
		for _, t := range times {
			avg += t
			if t < min {
				min = t
			}
			if t > max {
				max = t
			}
		}
		avg /= float64(len(times))

		googlePing := 0
		if len(googleTimes) > 0 {
			avgGoogle := 0.0
			for _, t := range googleTimes {
				avgGoogle += t
			}
			avgGoogle /= float64(len(googleTimes))
			googlePing = int(avgGoogle)
		}

		result := SpeedTestResult{
			Type:   "latency",
			Status: "completed",
			Latency: &LatencyResult{
				Average:    int(avg),
				Min:        int(min),
				Max:        int(max),
				GooglePing: googlePing,
			},
			Progress: 33.0,
		}
		reportSpeedTestResult(result)
	}
}

func testDownloadSpeedBackend() {
	testDuration := 10 * time.Second
	testFiles := []string{
		"https://speed.cloudflare.com/__down?bytes=10485760", // 10MB
		"https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png",
		"https://httpbin.org/bytes/5242880", // 5MB
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	var totalBytes int64
	startTime := time.Now()
	lastUpdate := startTime

	for time.Since(startTime) < testDuration {
		for _, url := range testFiles {
			if time.Since(startTime) >= testDuration {
				break
			}

			req, err := http.NewRequest("GET", url, nil)
			if err != nil {
				continue
			}
			req.Header.Set("Cache-Control", "no-cache")

			resp, err := client.Do(req)
			if err != nil {
				continue
			}

			if resp.StatusCode == http.StatusOK {
				// Read in chunks to allow for progress updates
				buffer := make([]byte, 64*1024) // 64KB chunks
				for {
					if time.Since(startTime) >= testDuration {
						resp.Body.Close()
						break
					}
					
					n, err := resp.Body.Read(buffer)
					if n > 0 {
						totalBytes += int64(n)
					}
					
					// Update progress every 100ms for smoother updates
					if time.Since(lastUpdate) > 100*time.Millisecond {
						elapsed := time.Since(startTime).Seconds()
						progress := (elapsed / testDuration.Seconds()) * 34.0 + 33.0 // 33% to 67%
						speed := float64(totalBytes) / elapsed

						result := SpeedTestResult{
							Type:          "download",
							Status:        "testing",
							DownloadSpeed: speed,
							Progress:      progress,
						}
						reportSpeedTestResult(result)
						lastUpdate = time.Now()
					}
					
					if err == io.EOF {
						break
					}
					if err != nil {
						break
					}
				}
				resp.Body.Close()
			}
		}
	}

	totalTime := time.Since(startTime).Seconds()
	finalSpeed := float64(totalBytes) / totalTime

	result := SpeedTestResult{
		Type:          "download",
		Status:        "completed",
		DownloadSpeed: finalSpeed,
		Progress:      66.0,
	}
	reportSpeedTestResult(result)
}

func testUploadSpeedBackend() {
	testDuration := 10 * time.Second
	chunkSize := 1024 * 1024 // 1MB
	testData := make([]byte, chunkSize)

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	var totalBytes int64
	var totalBytesMutex sync.Mutex
	startTime := time.Now()
	
	// Use a ticker to send updates every 100ms
	updateTicker := time.NewTicker(100 * time.Millisecond)
	defer updateTicker.Stop()
	
	// Channel to signal when test is done
	done := make(chan bool, 1)
	
	// Start upload loop in goroutine
	go func() {
		defer func() {
			done <- true
		}()
		
		for time.Since(startTime) < testDuration {
			// Create a new reader for each request
			reader := &infiniteReader{data: testData, size: chunkSize}
			body := io.NopCloser(reader)
			req, err := http.NewRequest("POST", "https://httpbin.org/post", body)
			if err != nil {
				continue
			}
			req.Header.Set("Content-Type", "application/octet-stream")
			req.ContentLength = int64(chunkSize)

			resp, err := client.Do(req)
			if err == nil && resp != nil {
				if resp.StatusCode == http.StatusOK {
					io.Copy(io.Discard, resp.Body)
					totalBytesMutex.Lock()
					totalBytes += int64(chunkSize)
					totalBytesMutex.Unlock()
				}
				resp.Body.Close()
			}
			
			// Small delay to avoid overwhelming the server
			time.Sleep(50 * time.Millisecond)
		}
	}()
	
	// Send progress updates every 100ms
	for {
		select {
		case <-done:
			// Send final result
			totalTime := time.Since(startTime).Seconds()
			if totalTime > 0 {
				totalBytesMutex.Lock()
				finalBytes := totalBytes
				totalBytesMutex.Unlock()
				finalSpeed := float64(finalBytes) / totalTime
				result := SpeedTestResult{
					Type:        "upload",
					Status:      "completed",
					UploadSpeed: finalSpeed,
					Progress:    100.0,
				}
				reportSpeedTestResult(result)
			}
			return
		case <-updateTicker.C:
			elapsed := time.Since(startTime).Seconds()
			if elapsed > 0 {
				progress := (elapsed / testDuration.Seconds()) * 34.0 + 66.0 // 66% to 100%
				if progress > 100 {
					progress = 100
				}
				totalBytesMutex.Lock()
				currentBytes := totalBytes
				totalBytesMutex.Unlock()
				speed := float64(currentBytes) / elapsed

				result := SpeedTestResult{
					Type:        "upload",
					Status:      "testing",
					UploadSpeed: speed,
					Progress:    progress,
				}
				reportSpeedTestResult(result)
			}
		}
	}
}

// infiniteReader is a reader that repeats the same data up to a certain size
type infiniteReader struct {
	data []byte
	size int
	pos  int
}

func (r *infiniteReader) Read(p []byte) (n int, err error) {
	if r.pos >= r.size {
		return 0, io.EOF
	}
	toRead := len(p)
	if r.pos+toRead > r.size {
		toRead = r.size - r.pos
	}
	for i := 0; i < toRead; i++ {
		p[i] = r.data[r.pos%len(r.data)]
		r.pos++
	}
	return toRead, nil
}

func reportSpeedTestResult(result SpeedTestResult) {
	data, _ := json.Marshal(result)
	fmt.Println(string(data))
}

