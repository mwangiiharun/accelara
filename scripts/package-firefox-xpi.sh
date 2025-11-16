#!/bin/bash
set -e

echo "📦 Packaging Firefox extension as XPI..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

FIREFOX_EXT_DIR="$PROJECT_ROOT/browser-extension/firefox"
OUTPUT_DIR="$PROJECT_ROOT/browser-extension"
VERSION=$(grep -o '"version": "[^"]*"' "$FIREFOX_EXT_DIR/manifest.json" | cut -d'"' -f4)
XPI_NAME="accelara-firefox-${VERSION}.xpi"
XPI_PATH="$OUTPUT_DIR/$XPI_NAME"

# Check if Firefox extension directory exists
if [ ! -d "$FIREFOX_EXT_DIR" ]; then
    echo "Error: Firefox extension directory not found at $FIREFOX_EXT_DIR"
    exit 1
fi

# Check if manifest.json exists
if [ ! -f "$FIREFOX_EXT_DIR/manifest.json" ]; then
    echo "Error: manifest.json not found in Firefox extension directory"
    exit 1
fi

echo -e "${GREEN}Step 1: Creating XPI package...${NC}"

# Create XPI file (it's just a ZIP file with .xpi extension)
cd "$FIREFOX_EXT_DIR"

# Remove old XPI if it exists
if [ -f "$XPI_PATH" ]; then
    rm "$XPI_PATH"
fi

# Create the XPI (ZIP) file
# Use -X to exclude extended attributes (macOS resource forks)
# Use -r for recursive
zip -X -r "$XPI_PATH" . -x "*.DS_Store" "*.git*" "*.xpi" "*/.DS_Store" > /dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ XPI package created successfully!${NC}"
    echo -e "${GREEN}Location: ${XPI_PATH}${NC}"
    
    # Get XPI size
    XPI_SIZE=$(du -h "$XPI_PATH" | cut -f1)
    echo -e "${GREEN}Size: ${XPI_SIZE}${NC}"
    
    # Verify the XPI
    echo -e "${YELLOW}Verifying XPI contents...${NC}"
    unzip -l "$XPI_PATH" | head -10
    
    echo ""
    echo -e "${GREEN}Installation instructions:${NC}"
    echo "1. Open Firefox and navigate to: about:addons"
    echo "2. Click the gear icon (⚙️) in the top right"
    echo "3. Select 'Install Add-on From File...'"
    echo "4. Select the XPI file: $XPI_PATH"
    echo ""
    echo "Or drag and drop the XPI file into Firefox!"
else
    echo "Error: Failed to create XPI package"
    exit 1
fi

