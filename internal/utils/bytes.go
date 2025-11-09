package utils

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// ParseBytes parses a byte size string like "4MB", "500KB", "2GB"
func ParseBytes(s string) (int64, error) {
	if s == "" {
		return 0, nil
	}

	re := regexp.MustCompile(`^\s*(\d+(?:\.\d+)?)\s*([kKmMgGtT]?[bB]?)?\s*$`)
	matches := re.FindStringSubmatch(s)
	if matches == nil {
		return 0, fmt.Errorf("invalid size: %s", s)
	}

	val, err := strconv.ParseFloat(matches[1], 64)
	if err != nil {
		return 0, err
	}

	unit := strings.ToLower(matches[2])
	multiplier := int64(1)

	switch unit {
	case "k", "kb":
		multiplier = 1024
	case "m", "mb":
		multiplier = 1024 * 1024
	case "g", "gb":
		multiplier = 1024 * 1024 * 1024
	case "t", "tb":
		multiplier = 1024 * 1024 * 1024 * 1024
	}

	return int64(val * float64(multiplier)), nil
}

// HumanBytes converts bytes to human-readable format
func HumanBytes(n int64) string {
	units := []string{"B", "KB", "MB", "GB", "TB"}
	i := 0
	val := float64(n)

	for val >= 1024 && i < len(units)-1 {
		val /= 1024
		i++
	}

	return fmt.Sprintf("%.2f%s", val, units[i])
}

// IsTorrentLike checks if source is a torrent (magnet or .torrent file)
func IsTorrentLike(src string) bool {
	if strings.HasPrefix(src, "magnet:") {
		return true
	}
	if strings.HasSuffix(strings.ToLower(src), ".torrent") {
		return true
	}
	return false
}
