#!/bin/bash
set -e

echo "🔨 Building ACCELARA with Tauri..."

# Build Go binaries
echo "📦 Building Go binaries..."
make build-api

# Build React frontend
echo "⚛️  Building React frontend..."
npm run build:react

# Verify required resources are in dist
echo "🔍 Verifying resources..."
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REQUIRED_FILES=("index.html" "debug-logs.html")
MISSING_FILES=()

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$PROJECT_ROOT/dist/$file" ]; then
        MISSING_FILES+=("$file")
    fi
done

if [ ${#MISSING_FILES[@]} -ne 0 ]; then
    echo "⚠️  Missing files in dist/, copying from public/..."
    mkdir -p "$PROJECT_ROOT/dist"
    for file in "${MISSING_FILES[@]}"; do
        if [ -f "$PROJECT_ROOT/public/$file" ]; then
            cp "$PROJECT_ROOT/public/$file" "$PROJECT_ROOT/dist/$file"
            echo "  ✓ Copied $file"
        else
            echo "  ✗ $file not found in public/"
            exit 1
        fi
    done
fi

# Verify Go binaries
echo "🔍 Verifying Go binaries..."
REQUIRED_BINARIES=("api-wrapper" "iris")
MISSING_BINARIES=()

for binary in "${REQUIRED_BINARIES[@]}"; do
    if [ ! -f "$PROJECT_ROOT/bin/$binary" ]; then
        MISSING_BINARIES+=("$binary")
    fi
done

if [ ${#MISSING_BINARIES[@]} -ne 0 ]; then
    echo "❌ Missing binaries in bin/:"
    for binary in "${MISSING_BINARIES[@]}"; do
        echo "  - $binary"
    done
    exit 1
fi

echo "✓ All resources verified"

# Build Tauri app
echo "🦀 Building Tauri app..."
export PATH="$HOME/.cargo/bin:$PATH"
cd src-tauri
cargo build --release
cd ..

echo "✅ Build complete!"
echo ""
echo "The built app should be in: src-tauri/target/release/"

