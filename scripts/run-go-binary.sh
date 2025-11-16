#!/bin/bash

# Script to run the Go binary directly for debugging
# This allows you to see Go logs without Electron

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Find the Go binary
if [ -f "$PROJECT_ROOT/bin/api-wrapper" ]; then
    GO_BINARY="$PROJECT_ROOT/bin/api-wrapper"
elif [ -f "$PROJECT_ROOT/release/mac-arm64/ACCELARA.app/Contents/Resources/bin/api-wrapper" ]; then
    GO_BINARY="$PROJECT_ROOT/release/mac-arm64/ACCELARA.app/Contents/Resources/bin/api-wrapper"
elif [ -f "$PROJECT_ROOT/release/mac-x64/ACCELARA.app/Contents/Resources/bin/api-wrapper" ]; then
    GO_BINARY="$PROJECT_ROOT/release/mac-x64/ACCELARA.app/Contents/Resources/bin/api-wrapper"
else
    echo "Error: Go binary not found. Please build it first:"
    echo "  make build-api"
    exit 1
fi

echo "Using Go binary: $GO_BINARY"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Usage examples:"
echo ""
echo "1. Test HTTP download:"
echo "   $GO_BINARY --source 'https://example.com/file.zip' --output ~/Downloads"
echo ""
echo "2. Test torrent download:"
echo "   $GO_BINARY --source 'magnet:?xt=urn:btih:...' --output ~/Downloads"
echo ""
echo "3. Inspect torrent:"
echo "   $GO_BINARY --inspect --source 'magnet:?xt=urn:btih:...'"
echo ""
echo "4. Run speed test:"
echo "   $GO_BINARY --speedtest --test-type full"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "All Go logs (stdout/stderr) will be displayed below:"
echo "═══════════════════════════════════════════════════════════"
echo ""

# If arguments provided, run the binary with them
if [ $# -gt 0 ]; then
    "$GO_BINARY" "$@"
else
    # Show help
    "$GO_BINARY" --help
fi

