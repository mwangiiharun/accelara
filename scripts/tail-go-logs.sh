#!/bin/bash

# Script to tail the latest Go error log file in dev mode

LOG_DIR="$HOME/.accelara/logs"

if [ ! -d "$LOG_DIR" ]; then
    echo "Log directory not found: $LOG_DIR"
    echo ""
    echo "Creating log directory..."
    mkdir -p "$LOG_DIR"
    if [ $? -eq 0 ]; then
        echo "✓ Log directory created: $LOG_DIR"
        echo ""
        echo "Now start the app in dev mode:"
        echo "  npm run dev"
        echo ""
        echo "Then run this script again to tail the logs."
        exit 0
    else
        echo "✗ Failed to create log directory"
        exit 1
    fi
fi

# Find the latest log file
LATEST_LOG=$(ls -t "$LOG_DIR"/go-errors-*.log 2>/dev/null | head -1)

if [ -z "$LATEST_LOG" ]; then
    echo "No Go log files found in $LOG_DIR"
    echo "Start the app in dev mode and trigger a Go error to create a log file."
    exit 1
fi

echo "Tailing Go error log: $LATEST_LOG"
echo "Press Ctrl+C to stop"
echo "═══════════════════════════════════════════════════════════"
echo ""

tail -f "$LATEST_LOG"

