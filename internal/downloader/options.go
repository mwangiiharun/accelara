package downloader

// StatusReporter interface for reporting download status
type StatusReporter interface {
	Report(status map[string]interface{})
}

// Options contains all download options
type Options struct {
	Connections    int
	ChunkSize      int64
	RateLimit      int64
	Proxy          string
	Retries        int
	ConnectTimeout int
	ReadTimeout    int
	SHA256         string
	BTUploadLimit  int64
	BTSequential   bool
	BTKeepSeeding  bool
	Quiet          bool
	StatusReporter StatusReporter
	DownloadID     string // For state persistence
}
