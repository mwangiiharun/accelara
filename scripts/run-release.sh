#!/bin/bash
# Script to run ACCELARA release build from command line with full logging

APP_PATH="/Users/mwangiiharun/projects/open-source/accelara/release/mac-arm64/ACCELARA.app"
EXECUTABLE="$APP_PATH/Contents/MacOS/ACCELARA"

if [ ! -f "$EXECUTABLE" ]; then
    echo "Error: Executable not found at $EXECUTABLE"
    exit 1
fi

echo "Running ACCELARA with full console output..."
echo "Press Ctrl+C to stop"
echo "=========================================="
echo ""

# Run with all output visible
# Set environment variables for better logging
export ELECTRON_ENABLE_LOGGING=1
export ELECTRON_ENABLE_STACK_DUMPING=1

# Run the executable and capture all output
"$EXECUTABLE" 2>&1 | tee /tmp/accelara-console.log

