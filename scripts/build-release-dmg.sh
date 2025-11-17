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

# Mount the DMG to access the app bundle inside
echo -e "${GREEN}Step 4: Mounting DMG to fix app bundle...${NC}"

# Check if already mounted
MOUNT_POINT=$(hdiutil info | grep -A 5 "$DMG_PATH" | grep "/Volumes/" | awk '{print $3}' | head -1)

# If not mounted, mount it
if [ -z "$MOUNT_POINT" ] || [ ! -d "$MOUNT_POINT" ]; then
    MOUNT_OUTPUT=$(hdiutil attach -nobrowse -quiet "$DMG_PATH" 2>&1)
    # Try multiple parsing methods
    MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | grep -o '/Volumes/[^[:space:]]*' | head -1)
    if [ -z "$MOUNT_POINT" ]; then
        MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | awk '/\/Volumes\// {print $3; exit}')
    fi
    if [ -z "$MOUNT_POINT" ]; then
        # Try finding by volume name
        MOUNT_POINT=$(ls -d /Volumes/ACCELARA* 2>/dev/null | head -1)
    fi
fi

if [ -n "$MOUNT_POINT" ] && [ -d "$MOUNT_POINT" ]; then
    echo "DMG mounted at: $MOUNT_POINT"
    
    # Find the app bundle in the mounted volume
    APP_BUNDLE=$(find "$MOUNT_POINT" -name "*.app" -type d -maxdepth 1 2>/dev/null | head -1)
    
    if [ -n "$APP_BUNDLE" ] && [ -d "$APP_BUNDLE" ]; then
        echo -e "${GREEN}Step 5: Copying app bundle to temporary location...${NC}"
        echo "App bundle found at: $APP_BUNDLE"
        
        # Create a temporary directory for DMG contents
        TEMP_DMG_DIR=$(mktemp -d)
        
        # Copy app bundle to writable location
        TEMP_APP_BUNDLE="$TEMP_DMG_DIR/$(basename "$APP_BUNDLE")"
        cp -R "$APP_BUNDLE" "$TEMP_APP_BUNDLE"
        
        echo -e "${GREEN}Step 6: Removing quarantine and code signing app bundle...${NC}"
        
        # Remove quarantine attribute (if present)
        xattr -cr "$TEMP_APP_BUNDLE" 2>/dev/null || echo -e "${YELLOW}Warning: Could not remove quarantine attributes${NC}"
        
        # Ad-hoc code sign the app bundle (doesn't require a certificate)
        # This makes Gatekeeper happier even without a developer certificate
        codesign --force --deep --sign - "$TEMP_APP_BUNDLE" 2>/dev/null || echo -e "${YELLOW}Warning: Could not code sign app bundle${NC}"
        
        # Verify the signature
        codesign --verify --verbose "$TEMP_APP_BUNDLE" 2>/dev/null || echo -e "${YELLOW}Warning: Code signature verification failed${NC}"
        
        echo -e "${GREEN}✓ App bundle prepared (quarantine removed, ad-hoc signed)${NC}"
        
        # Create Applications symlink if it exists in the original
        if [ -L "$MOUNT_POINT/Applications" ] || [ -d "$MOUNT_POINT/Applications" ]; then
            ln -s /Applications "$TEMP_DMG_DIR/Applications"
        fi
        
        # Unmount the DMG
        echo -e "${GREEN}Step 7: Unmounting DMG...${NC}"
        hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || {
            # Force unmount if regular unmount fails
            sleep 1
            hdiutil detach "$MOUNT_POINT" -force -quiet 2>/dev/null || true
        }
        
        # Remove old DMG
        rm -f "$DMG_PATH"
        
        # Create new DMG with the fixed app bundle
        echo -e "${GREEN}Step 8: Recreating DMG with fixed app bundle...${NC}"
        hdiutil create -volname "ACCELARA" -srcfolder "$TEMP_DMG_DIR" -ov -format UDZO "$DMG_PATH" 2>&1 || {
            echo -e "${RED}Error: Failed to recreate DMG${NC}"
            exit 1
        }
        
        # Clean up
        rm -rf "$TEMP_DMG_DIR"
        
        echo -e "${GREEN}✓ DMG recreated with fixed app bundle${NC}"
    else
        echo -e "${YELLOW}⚠ Warning: App bundle not found in mounted DMG${NC}"
        # Unmount if we mounted but didn't find the app
        hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || hdiutil detach "$MOUNT_POINT" -force -quiet 2>/dev/null || true
    fi
else
    echo -e "${YELLOW}⚠ Warning: Could not mount DMG for code signing${NC}"
    echo "Mount output: $MOUNT_OUTPUT"
fi

echo -e "${GREEN}✅ Release DMG created successfully!${NC}"
echo -e "${GREEN}Location: ${DMG_PATH}${NC}"

# Get DMG size
DMG_SIZE=$(du -h "$DMG_PATH" | cut -f1)
echo -e "${GREEN}Size: ${DMG_SIZE}${NC}"

# Optionally open the folder
echo -e "${YELLOW}Opening DMG location...${NC}"
open "$(dirname "$DMG_PATH")"

