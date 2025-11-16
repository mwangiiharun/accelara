#!/bin/bash

cd "$(dirname "$0")/.."

echo "🔍 Rust Compilation Status Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if binary exists
if [ -f "src-tauri/target/debug/accelara" ]; then
    echo "✅ COMPILATION COMPLETE!"
    echo "   Binary: src-tauri/target/debug/accelara"
    ls -lh src-tauri/target/debug/accelara
    exit 0
fi

# Check if target directory exists
if [ ! -d "src-tauri/target/debug" ]; then
    echo "⏳ Compilation just started..."
    echo "   No target/debug directory yet"
    exit 1
fi

# Count compiled dependencies
DEPS_COUNT=$(find src-tauri/target/debug/deps -name "*.rlib" 2>/dev/null | wc -l | tr -d ' ')
echo "📦 Compilation in progress..."
echo "   Compiled dependencies: $DEPS_COUNT"
echo ""

# Check for cargo processes
CARGO_PROCESSES=$(ps aux | grep -E "cargo.*run|cargo.*build" | grep -v grep | wc -l | tr -d ' ')
if [ "$CARGO_PROCESSES" -gt 0 ]; then
    echo "🔄 Cargo processes running: $CARGO_PROCESSES"
    ps aux | grep -E "cargo.*run|cargo.*build" | grep -v grep | head -2 | awk '{print "   " $11 " " $12 " " $13}'
else
    echo "⚠️  No active cargo processes found"
fi

echo ""
echo "💡 Tip: Watch the terminal running 'npm run dev:tauri' for detailed progress"
echo "   Look for 'Finished' message when compilation completes"

exit 1

