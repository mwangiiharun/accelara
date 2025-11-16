#!/bin/bash
# Download Iris binary/script from GitHub repository

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$PROJECT_ROOT/bin"
IRIS_PATH="$BIN_DIR/iris"

echo "Downloading Iris from GitHub repository..."

# Create bin directory if it doesn't exist
mkdir -p "$BIN_DIR"

# Download Iris script from the main branch
IRIS_URL="https://raw.githubusercontent.com/mwangiiharun/iris/main/bin/iris"

if curl -s -f -o "$IRIS_PATH" "$IRIS_URL"; then
    echo "✓ Downloaded Iris successfully"
    
    # Make it executable
    chmod +x "$IRIS_PATH"
    echo "✓ Made Iris executable"
    
    # Verify it's a valid script
    if [ -f "$IRIS_PATH" ] && [ -x "$IRIS_PATH" ]; then
        echo "✓ Iris verified at: $IRIS_PATH"
        echo "  File size: $(du -h "$IRIS_PATH" | cut -f1)"
    else
        echo "✗ ERROR: Failed to verify Iris"
        exit 1
    fi
else
    echo "✗ ERROR: Failed to download Iris from $IRIS_URL"
    exit 1
fi

