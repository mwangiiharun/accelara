package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type SpeedTestResult struct {
	Type          string        `json:"type"`
	DownloadSpeed float64       `json:"download_speed,omitempty"` // bytes per second
	UploadSpeed   float64       `json:"upload_speed,omitempty"`   // bytes per second
	Latency       *LatencyResult `json:"latency,omitempty"`
	Progress      float64       `json:"progress,omitempty"`
	Status        string        `json:"status"`
}

type LatencyResult struct {
	Average    int `json:"average"`
	Min        int `json:"min"`
	Max        int `json:"max"`
	GooglePing int `json:"google_ping,omitempty"`
}

// IrisResult represents the JSON output from Iris
type IrisResult struct {
	Timestamp    string  `json:"timestamp"`
	DownloadMbps float64 `json:"download_mbps"`
	UploadMbps   float64 `json:"upload_mbps"`
	PingMs       float64 `json:"ping_ms"`
	Server       string  `json:"server"`
	ISP          string  `json:"isp"`
	Location     struct {
		City    string `json:"city"`
		Country string `json:"country"`
		IP      string `json:"ip"`
	} `json:"location"`
	Rating string `json:"rating"`
}

func runSpeedTestWithType(testType string) {
	if testType == "" {
		testType = "full"
	}

	// Find Iris binary
	irisPath, err := findIrisBinary()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: Iris not found: %v\n", err)
		fmt.Fprintf(os.Stderr, "Please install Iris: brew tap mwangiiharun/homebrew-iris && brew install iris\n")
		os.Exit(1)
	}

	// Run Iris with JSON output
	cmd := exec.Command(irisPath, "--json", "--quiet")
	cmd.Stderr = os.Stderr

	// Start progress simulation in a goroutine
	progressDone := make(chan bool)
	go func() {
		simulateProgressForTestType(testType, progressDone)
	}()

	// Start the command
	startTime := time.Now()
	output, err := cmd.Output()
	elapsed := time.Since(startTime)

	// Stop progress simulation
	close(progressDone)
	time.Sleep(100 * time.Millisecond) // Give progress goroutine time to stop

	if err != nil {
		fmt.Fprintf(os.Stderr, "Error running Iris: %v\n", err)
		os.Exit(1)
	}

	// Parse Iris JSON output
	var irisResult IrisResult
	if err := json.Unmarshal(output, &irisResult); err != nil {
		// Try to find JSON in the output (in case there's extra text)
		lines := strings.Split(string(output), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "{") && strings.HasSuffix(line, "}") {
				if err := json.Unmarshal([]byte(line), &irisResult); err == nil {
					break
				}
			}
		}
		// If still no valid JSON, report error
		if irisResult.DownloadMbps == 0 && irisResult.UploadMbps == 0 && irisResult.PingMs == 0 {
			fmt.Fprintf(os.Stderr, "Error: Failed to parse Iris output\n")
			fmt.Fprintf(os.Stderr, "Output: %s\n", string(output))
			os.Exit(1)
		}
	}

	// Convert Iris results to ACCELARA format based on test type
	switch testType {
	case "latency":
		reportLatencyFromIris(irisResult, elapsed)
	case "download":
		reportDownloadFromIris(irisResult, elapsed)
	case "upload":
		reportUploadFromIris(irisResult, elapsed)
	case "full":
		reportFullFromIris(irisResult, elapsed)
	default:
		fmt.Fprintf(os.Stderr, "Error: invalid test type: %s\n", testType)
		os.Exit(1)
	}
}

func reportLatencyFromIris(iris IrisResult, elapsed time.Duration) {
	// Convert ping_ms to latency result
	pingMs := int(iris.PingMs)
	result := SpeedTestResult{
		Type:   "latency",
		Status: "completed",
		Latency: &LatencyResult{
			Average:    pingMs,
			Min:        pingMs, // Iris only provides average ping
			Max:        pingMs,
			GooglePing: pingMs, // Use same value for Google ping
		},
		Progress: 33.0,
	}
	reportSpeedTestResult(result)
}

func reportDownloadFromIris(iris IrisResult, elapsed time.Duration) {
	// Convert MB/s to bytes/s, then divide by 10
	downloadBytesPerSec := (iris.DownloadMbps * 1024 * 1024) / 10

	result := SpeedTestResult{
		Type:          "download",
		Status:        "completed",
		DownloadSpeed: downloadBytesPerSec,
		Progress:      66.0,
	}
	reportSpeedTestResult(result)
}

func reportUploadFromIris(iris IrisResult, elapsed time.Duration) {
	// Convert MB/s to bytes/s, then divide by 10
	uploadBytesPerSec := (iris.UploadMbps * 1024 * 1024) / 10

	result := SpeedTestResult{
		Type:        "upload",
		Status:      "completed",
		UploadSpeed: uploadBytesPerSec,
		Progress:    100.0,
	}
	reportSpeedTestResult(result)
}

func reportFullFromIris(iris IrisResult, elapsed time.Duration) {
	// Report latency
	pingMs := int(iris.PingMs)
	latencyResult := SpeedTestResult{
		Type:   "latency",
		Status: "completed",
		Latency: &LatencyResult{
			Average:    pingMs,
			Min:        pingMs,
			Max:        pingMs,
			GooglePing: pingMs,
		},
		Progress: 33.0,
	}
	reportSpeedTestResult(latencyResult)

	// Report download
	downloadBytesPerSec := (iris.DownloadMbps * 1024 * 1024) / 10
	downloadResult := SpeedTestResult{
		Type:          "download",
		Status:        "completed",
		DownloadSpeed: downloadBytesPerSec,
		Progress:      66.0,
	}
	reportSpeedTestResult(downloadResult)

	// Report upload
	uploadBytesPerSec := (iris.UploadMbps * 1024 * 1024) / 10
	uploadResult := SpeedTestResult{
		Type:        "upload",
		Status:      "completed",
		UploadSpeed: uploadBytesPerSec,
		Progress:    100.0,
	}
	reportSpeedTestResult(uploadResult)
}

// simulateProgressForTestType sends progress updates during the test based on test type
func simulateProgressForTestType(testType string, done chan bool) {
	var startProgress, endProgress float64
	var estimatedDuration time.Duration

	switch testType {
	case "latency":
		startProgress = 0
		endProgress = 33.0
		estimatedDuration = 5 * time.Second
	case "download":
		startProgress = 33.0
		endProgress = 66.0
		estimatedDuration = 15 * time.Second
	case "upload":
		startProgress = 66.0
		endProgress = 100.0
		estimatedDuration = 15 * time.Second
	case "full":
		// For full test, simulate all phases
		simulateFullTestProgress(done)
		return
	default:
		return
	}

	updateInterval := 200 * time.Millisecond
	progressRange := endProgress - startProgress
	steps := int(estimatedDuration / updateInterval)
	if steps < 1 {
		steps = 1
	}
	progressIncrement := progressRange / float64(steps)

	currentProgress := startProgress
	startTime := time.Now()

	for {
		select {
		case <-done:
			return
		default:
			elapsed := time.Since(startTime)
			if elapsed >= estimatedDuration {
				return
			}

			result := SpeedTestResult{
				Type:     testType,
				Status:   "testing",
				Progress: currentProgress,
			}
			reportSpeedTestResult(result)

			currentProgress += progressIncrement
			if currentProgress > endProgress {
				currentProgress = endProgress
			}

			time.Sleep(updateInterval)
		}
	}
}

// simulateFullTestProgress simulates progress for a full test (latency + download + upload)
func simulateFullTestProgress(done chan bool) {
	// Phase 1: Latency (0-33%)
	simulatePhase("latency", 0, 33.0, 5*time.Second, done)
	
	// Phase 2: Download (33-66%)
	simulatePhase("download", 33.0, 66.0, 15*time.Second, done)
	
	// Phase 3: Upload (66-100%)
	simulatePhase("upload", 66.0, 100.0, 15*time.Second, done)
}

func simulatePhase(testType string, startProgress, endProgress float64, duration time.Duration, done chan bool) {
	updateInterval := 200 * time.Millisecond
	progressRange := endProgress - startProgress
	steps := int(duration / updateInterval)
	if steps < 1 {
		steps = 1
	}
	progressIncrement := progressRange / float64(steps)

	currentProgress := startProgress
	startTime := time.Now()

	for {
		select {
		case <-done:
			return
		default:
			elapsed := time.Since(startTime)
			if elapsed >= duration {
				return
			}

			result := SpeedTestResult{
				Type:     testType,
				Status:   "testing",
				Progress: currentProgress,
			}
			reportSpeedTestResult(result)

			currentProgress += progressIncrement
			if currentProgress > endProgress {
				currentProgress = endProgress
			}

			time.Sleep(updateInterval)
		}
	}
}

// findIrisBinary searches for the Iris binary in bundled location first, then common locations
func findIrisBinary() (string, error) {
	var paths []string

	// First, try to find Iris in the bundled location (same directory as this executable)
	// This works for both dev and packaged apps
	if execPath, err := os.Executable(); err == nil {
		execDir := filepath.Dir(execPath)
		
		// In packaged apps, binaries are in Resources/bin/
		// Try relative to executable first (for dev builds)
		bundledPaths := []string{
			filepath.Join(execDir, "iris"),                    // Same dir as executable
			filepath.Join(execDir, "bin", "iris"),              // bin subdirectory
			filepath.Join(execDir, "..", "bin", "iris"),        // Parent/bin
			filepath.Join(execDir, "..", "Resources", "bin", "iris"), // macOS app bundle Resources/bin
			filepath.Join(execDir, "..", "..", "Resources", "bin", "iris"), // macOS app bundle (if executable is in MacOS/)
		}
		paths = append(paths, bundledPaths...)
	}

	// Then try common system paths
	systemPaths := []string{
		"iris", // In PATH
		"/usr/local/bin/iris",
		"/opt/homebrew/bin/iris",
		filepath.Join(os.Getenv("HOME"), "bin", "iris"),
	}
	paths = append(paths, systemPaths...)

	// On macOS, also check Homebrew paths
	if runtime.GOOS == "darwin" {
		homebrewPaths := []string{
			"/opt/homebrew/bin/iris",
			"/usr/local/bin/iris",
		}
		paths = append(paths, homebrewPaths...)
	}

	// Try to find via which/where
	if whichPath, err := exec.LookPath("iris"); err == nil {
		paths = append([]string{whichPath}, paths...)
	}

	// Check each path
	for _, p := range paths {
		// Resolve absolute path
		absPath, err := filepath.Abs(p)
		if err != nil {
			continue
		}
		
		if info, err := os.Stat(absPath); err == nil {
			// Verify it's executable
			if info.Mode().Perm()&0111 != 0 {
				return absPath, nil
			}
		}
	}

	return "", fmt.Errorf("Iris binary not found in bundled or common locations")
}

// Keep runSpeedTest for backward compatibility
func runSpeedTest() {
	runSpeedTestWithType("full")
}

func reportSpeedTestResult(result SpeedTestResult) {
	data, _ := json.Marshal(result)
	fmt.Println(string(data))
}
