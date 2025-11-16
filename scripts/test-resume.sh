#!/bin/bash

# Test script for resume functionality
# This script tests if downloads resume correctly after app restart

echo "🧪 Testing Resume Functionality"
echo "================================"
echo ""

DMG_PATH="src-tauri/target/release/bundle/dmg/ACCELARA_3.0.0_aarch64.dmg"
APP_PATH="/Applications/ACCELARA.app"

# Check if DMG exists
if [ ! -f "$DMG_PATH" ]; then
    echo "❌ DMG not found at: $DMG_PATH"
    echo "   Please build the DMG first with: npm run build"
    exit 1
fi

echo "✅ DMG found at: $DMG_PATH"
echo ""

# Check if app is installed
if [ ! -d "$APP_PATH" ]; then
    echo "⚠️  App not installed. Please install from DMG first."
    echo "   Opening DMG..."
    open "$DMG_PATH"
    echo ""
    echo "📋 Manual Test Steps:"
    echo "   1. Drag ACCELARA.app to Applications folder"
    echo "   2. Open ACCELARA from Applications"
    echo "   3. Start a download (HTTP or torrent)"
    echo "   4. Let it download for a few seconds"
    echo "   5. Close the app completely (Cmd+Q)"
    echo "   6. Reopen ACCELARA"
    echo "   7. Check if the download auto-resumes"
    echo ""
    echo "   Expected behavior:"
    echo "   - Download should appear in the list"
    echo "   - Download should automatically resume"
    echo "   - Progress should be restored (not start from 0)"
    exit 0
fi

echo "✅ App installed at: $APP_PATH"
echo ""

# Test database location
DB_PATH="$HOME/Library/Application Support/com.mwangiiharun.accelara/accelara.db"

if [ -f "$DB_PATH" ]; then
    echo "✅ Database found at: $DB_PATH"
    echo ""
    
    # Check for paused/downloading downloads
    echo "📊 Checking for downloads to resume..."
    sqlite3 "$DB_PATH" "SELECT id, source, status, progress, downloaded, total FROM downloads WHERE status IN ('downloading', 'paused') ORDER BY started_at DESC LIMIT 5;" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ Database is accessible"
    else
        echo "⚠️  Could not query database (may need to install sqlite3)"
    fi
else
    echo "⚠️  Database not found (app may not have been run yet)"
fi

echo ""
echo "📋 Resume Test Checklist:"
echo "   [ ] 1. Start a new download"
echo "   [ ] 2. Let it download for 10-30 seconds"
echo "   [ ] 3. Note the downloaded bytes/progress"
echo "   [ ] 4. Close the app completely (Cmd+Q)"
echo "   [ ] 5. Reopen ACCELARA"
echo "   [ ] 6. Verify download appears in list"
echo "   [ ] 7. Verify download auto-resumes"
echo "   [ ] 8. Verify progress is restored (not 0 bytes)"
echo "   [ ] 9. Verify download continues from where it left off"
echo ""
echo "🔍 Debug Tips:"
echo "   - Check debug logs: Window > Debug Logs"
echo "   - Look for '[auto-resume]' messages in logs"
echo "   - Check for '[resume-download]' messages"
echo "   - Verify output path exists and has partial files"
echo ""

