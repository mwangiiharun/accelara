#!/bin/bash
set -e

echo "🚀 Building optimized ACCELARA DMG release..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}Error: This script is for macOS only${NC}"
    exit 1
fi

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${GREEN}Step 1: Building Go binaries...${NC}"
make build-api
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to build Go binaries${NC}"
    exit 1
fi

echo -e "${GREEN}Step 2: Building React frontend...${NC}"
npm run build:react
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to build React frontend${NC}"
    exit 1
fi

# Verify required resources are in dist
echo -e "${GREEN}Step 2.5: Verifying resources...${NC}"
REQUIRED_FILES=("index.html" "debug-logs.html")
MISSING_FILES=()

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$PROJECT_ROOT/dist/$file" ]; then
        MISSING_FILES+=("$file")
    fi
done

if [ ${#MISSING_FILES[@]} -ne 0 ]; then
    echo -e "${RED}Error: Missing required files in dist/:${NC}"
    for file in "${MISSING_FILES[@]}"; do
        echo -e "${RED}  - $file${NC}"
    done
    echo -e "${YELLOW}Attempting to copy from public/...${NC}"
    mkdir -p "$PROJECT_ROOT/dist"
    for file in "${MISSING_FILES[@]}"; do
        if [ -f "$PROJECT_ROOT/public/$file" ]; then
            cp "$PROJECT_ROOT/public/$file" "$PROJECT_ROOT/dist/$file"
            echo -e "${GREEN}  ✓ Copied $file${NC}"
        else
            echo -e "${RED}  ✗ $file not found in public/ either${NC}"
            exit 1
        fi
    done
fi

# Verify Go binaries are in bin/
echo -e "${GREEN}Step 2.6: Verifying Go binaries...${NC}"
REQUIRED_BINARIES=("api-wrapper" "iris")
MISSING_BINARIES=()

for binary in "${REQUIRED_BINARIES[@]}"; do
    if [ ! -f "$PROJECT_ROOT/bin/$binary" ]; then
        MISSING_BINARIES+=("$binary")
    fi
done

if [ ${#MISSING_BINARIES[@]} -ne 0 ]; then
    echo -e "${RED}Error: Missing required binaries in bin/:${NC}"
    for binary in "${MISSING_BINARIES[@]}"; do
        echo -e "${RED}  - $binary${NC}"
    done
    exit 1
fi

echo -e "${GREEN}✓ All resources verified${NC}"

echo -e "${GREEN}Step 3: Building Tauri app (optimized release)...${NC}"
# Build in release mode with optimizations
export PATH="$HOME/.cargo/bin:$PATH"
npx tauri build --bundles dmg
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to build Tauri app${NC}"
    exit 1
fi

# Find the DMG file
DMG_PATH=$(find "$PROJECT_ROOT/src-tauri/target/release/bundle/dmg" -name "*.dmg" 2>/dev/null | head -1)

if [ -z "$DMG_PATH" ]; then
    echo -e "${RED}Error: DMG file not found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Release DMG created successfully!${NC}"
echo -e "${GREEN}Location: ${DMG_PATH}${NC}"

# Get DMG size
DMG_SIZE=$(du -h "$DMG_PATH" | cut -f1)
echo -e "${GREEN}Size: ${DMG_SIZE}${NC}"

# Optionally open the folder
echo -e "${YELLOW}Opening DMG location...${NC}"
open "$(dirname "$DMG_PATH")"

