package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"sync/atomic"
	"time"
)

type SpeedTestResult struct {
	Type          string         `json:"type"`
	DownloadSpeed float64        `json:"download_speed,omitempty"` // bytes per second
	UploadSpeed   float64        `json:"upload_speed,omitempty"`   // bytes per second
	Latency       *LatencyResult `json:"latency,omitempty"`
	Progress      float64        `json:"progress,omitempty"`
	Status        string         `json:"status"`
}

type LatencyResult struct {
	Average    int `json:"average"`
	Min        int `json:"min"`
	Max        int `json:"max"`
	GooglePing int `json:"google_ping,omitempty"`
}

// mbpsToBytesPerSec converts megabits/sec to bytes/sec: 1 Mbps is 1,000,000
// bits/sec, and there are 8 bits per byte.
func mbpsToBytesPerSec(mbps float64) float64 {
	return mbps * 1_000_000 / 8
}

const (
	sampleInterval = 250 * time.Millisecond

	// Cloudflare's public speed-test endpoints - built for exactly this,
	// no auth, no rate limiting for a single client.
	//
	// NOTE: __down silently caps out somewhere between 50MB and 100MB - ask
	// for more than its real limit and it returns a ~1-byte body instead of
	// an error, which used to make every "download" phase read tanked to
	// a few bytes/sec (constant reconnect-on-EOF, never any real data).
	// 50MB is confirmed to work reliably; runDownloadPhase re-fetches a
	// fresh one whenever a chunk is exhausted before the time budget.
	cfDownloadURL = "https://speed.cloudflare.com/__down?bytes=52428800" // 50MB, safely under the cap
	cfUploadURL   = "https://speed.cloudflare.com/__up"
	cfPingURL     = "https://speed.cloudflare.com/__down?bytes=0"
)

// runSpeedTestWithType runs a real, actively-measured speed test for
// ~30 seconds total (full test): live latency samples, then live download
// throughput samples, then live upload throughput samples. Every sample is
// streamed immediately over stdout so the UI can chart real variation, not
// a simulated progress bar.
func runSpeedTestWithType(testType string) {
	if testType == "" {
		testType = "full"
	}

	switch testType {
	case "latency":
		runLatencyPhase(8*time.Second, 0, 100)
	case "download":
		runDownloadPhase(12*time.Second, 0, 100)
	case "upload":
		runUploadPhase(12*time.Second, 0, 100)
	case "full":
		latency := runLatencyPhase(5*time.Second, 0, 33)
		download := runDownloadPhase(12*time.Second, 33, 33)
		upload := runUploadPhase(12*time.Second, 66, 34)
		reportSpeedTestResult(SpeedTestResult{
			Type:          "full",
			Status:        "completed",
			DownloadSpeed: download,
			UploadSpeed:   upload,
			Latency:       latency,
			Progress:      100.0,
		})
	default:
		fmt.Fprintf(os.Stderr, "Error: invalid test type: %s\n", testType)
		os.Exit(1)
	}
}

func progressAt(base, rng float64, elapsed, total time.Duration) float64 {
	frac := math.Min(float64(elapsed)/float64(total), 1.0)
	return base + rng*frac
}

// runLatencyPhase measures real round-trip time to a reliable endpoint,
// repeatedly, for the given duration, streaming each sample live.
func runLatencyPhase(duration time.Duration, base, rng float64) *LatencyResult {
	client := &http.Client{Timeout: 5 * time.Second}
	var samples []int
	start := time.Now()

	for time.Since(start) < duration {
		reqStart := time.Now()
		resp, err := client.Head(cfPingURL)
		rtt := int(time.Since(reqStart).Milliseconds())
		if err == nil {
			resp.Body.Close()
			samples = append(samples, rtt)
			reportSpeedTestResult(SpeedTestResult{
				Type:     "latency",
				Status:   "testing",
				Progress: progressAt(base, rng, time.Since(start), duration),
				Latency:  &LatencyResult{Average: rtt, Min: rtt, Max: rtt},
			})
		}
		time.Sleep(300 * time.Millisecond)
	}

	result := &LatencyResult{}
	if len(samples) > 0 {
		sum, min, max := 0, samples[0], samples[0]
		for _, s := range samples {
			sum += s
			if s < min {
				min = s
			}
			if s > max {
				max = s
			}
		}
		avg := sum / len(samples)
		result = &LatencyResult{Average: avg, Min: min, Max: max, GooglePing: avg}
	}

	reportSpeedTestResult(SpeedTestResult{
		Type: "latency", Status: "completed", Progress: base + rng, Latency: result,
	})
	return result
}

// runDownloadPhase streams a real download for the given duration, measuring
// actual instantaneous throughput on a fixed tick and reporting each sample
// live. Re-fetches if the response body is exhausted before the time budget
// (very fast connections).
func runDownloadPhase(duration time.Duration, base, rng float64) float64 {
	client := &http.Client{Timeout: duration + 15*time.Second}
	start := time.Now()

	var samples []float64
	var bytesSinceTick int64
	lastTick := start
	buf := make([]byte, 64*1024)

	resp, err := client.Get(cfDownloadURL)
	if err != nil {
		reportSpeedTestResult(SpeedTestResult{Type: "download", Status: "error", Progress: base + rng})
		return 0
	}

	for time.Since(start) < duration {
		n, readErr := resp.Body.Read(buf)
		bytesSinceTick += int64(n)

		now := time.Now()
		if now.Sub(lastTick) >= sampleInterval {
			instantRate := float64(bytesSinceTick) / now.Sub(lastTick).Seconds()
			samples = append(samples, instantRate)
			reportSpeedTestResult(SpeedTestResult{
				Type: "download", Status: "testing",
				Progress:      progressAt(base, rng, now.Sub(start), duration),
				DownloadSpeed: instantRate,
			})
			bytesSinceTick = 0
			lastTick = now
		}

		if readErr != nil {
			resp.Body.Close()
			if time.Since(start) >= duration {
				break
			}
			// Body ran out before the time budget - grab another one.
			resp, err = client.Get(cfDownloadURL)
			if err != nil {
				break
			}
		}
	}
	if resp != nil {
		resp.Body.Close()
	}

	avg := trimmedAverage(samples)
	reportSpeedTestResult(SpeedTestResult{
		Type: "download", Status: "completed", Progress: base + rng, DownloadSpeed: avg,
	})
	return avg
}

// countingReader produces zero-filled bytes (content is irrelevant for an
// upload throughput test) and reports every byte written through onRead.
type countingReader struct {
	remaining int64
	written   *int64
}

func (r *countingReader) Read(p []byte) (int, error) {
	if r.remaining <= 0 {
		return 0, io.EOF
	}
	n := len(p)
	if int64(n) > r.remaining {
		n = int(r.remaining)
	}
	for i := 0; i < n; i++ {
		p[i] = 0
	}
	r.remaining -= int64(n)
	atomic.AddInt64(r.written, int64(n))
	return n, nil
}

// runUploadPhase uploads a stream of data for the given duration, measuring
// real throughput on a fixed tick via a background ticker while the upload
// request is in flight, and reporting each sample live.
func runUploadPhase(duration time.Duration, base, rng float64) float64 {
	var written int64
	const capSize = 500 * 1024 * 1024 // generous cap; duration is the real cutoff

	ctx, cancel := context.WithTimeout(context.Background(), duration+5*time.Second)
	defer cancel()

	reader := &countingReader{remaining: capSize, written: &written}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfUploadURL, reader)
	if err != nil {
		reportSpeedTestResult(SpeedTestResult{Type: "upload", Status: "error", Progress: base + rng})
		return 0
	}
	req.ContentLength = capSize
	req.Header.Set("Content-Type", "application/octet-stream")

	var samples []float64
	stopTicker := make(chan struct{})
	tickerStopped := make(chan struct{})

	go func() {
		defer close(tickerStopped)
		start := time.Now()
		var lastBytes int64
		ticker := time.NewTicker(sampleInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stopTicker:
				return
			case now := <-ticker.C:
				current := atomic.LoadInt64(&written)
				delta := current - lastBytes
				lastBytes = current
				instantRate := float64(delta) / sampleInterval.Seconds()
				samples = append(samples, instantRate)
				reportSpeedTestResult(SpeedTestResult{
					Type: "upload", Status: "testing",
					Progress:    progressAt(base, rng, now.Sub(start), duration),
					UploadSpeed: instantRate,
				})
			}
		}
	}()

	resp, doErr := http.DefaultClient.Do(req)
	close(stopTicker)
	<-tickerStopped
	if doErr == nil && resp != nil {
		resp.Body.Close()
	}

	avg := trimmedAverage(samples)
	reportSpeedTestResult(SpeedTestResult{
		Type: "upload", Status: "completed", Progress: base + rng, UploadSpeed: avg,
	})
	return avg
}

// trimmedAverage drops the first sample (connection ramp-up skews it low)
// when there are enough samples to spare, then averages the rest.
func trimmedAverage(samples []float64) float64 {
	if len(samples) == 0 {
		return 0
	}
	if len(samples) <= 2 {
		sum := 0.0
		for _, s := range samples {
			sum += s
		}
		return sum / float64(len(samples))
	}
	trimmed := samples[1:]
	sum := 0.0
	for _, s := range trimmed {
		sum += s
	}
	return sum / float64(len(trimmed))
}

func reportSpeedTestResult(result SpeedTestResult) {
	data, _ := json.Marshal(result)
	fmt.Println(string(data))
}
