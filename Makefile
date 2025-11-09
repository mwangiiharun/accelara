.PHONY: build build-cli build-api clean install

# Build both CLI and API wrapper
build: build-cli build-api

# Build CLI tool
build-cli:
	@echo "Building CLI tool..."
	@mkdir -p bin
	@go build -o bin/clidm ./cmd/clidm

# Build API wrapper for Electron
build-api:
	@echo "Building API wrapper..."
	@mkdir -p bin
	@go build -o bin/api-wrapper ./cmd/api-wrapper

# Build for all platforms
build-all:
	@echo "Building for all platforms..."
	@mkdir -p bin
	@GOOS=linux GOARCH=amd64 go build -o bin/clidm-linux-amd64 ./cmd/clidm
	@GOOS=linux GOARCH=amd64 go build -o bin/api-wrapper-linux-amd64 ./cmd/api-wrapper
	@GOOS=darwin GOARCH=amd64 go build -o bin/clidm-darwin-amd64 ./cmd/clidm
	@GOOS=darwin GOARCH=amd64 go build -o bin/api-wrapper-darwin-amd64 ./cmd/api-wrapper
	@GOOS=darwin GOARCH=arm64 go build -o bin/clidm-darwin-arm64 ./cmd/clidm
	@GOOS=darwin GOARCH=arm64 go build -o bin/api-wrapper-darwin-arm64 ./cmd/api-wrapper
	@GOOS=windows GOARCH=amd64 go build -o bin/clidm-windows-amd64.exe ./cmd/clidm
	@GOOS=windows GOARCH=amd64 go build -o bin/api-wrapper-windows-amd64.exe ./cmd/api-wrapper

# Install dependencies
install:
	@echo "Installing Go dependencies..."
	@go mod download
	@go mod tidy

# Clean build artifacts
clean:
	@echo "Cleaning..."
	@rm -rf bin/
	@go clean

# Run tests
test:
	@go test ./...

