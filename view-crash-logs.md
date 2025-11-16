# How to View Crash Logs for ACCELARA

## Method 1: Run from Terminal (Best for Debugging)
Run the app directly from terminal to see all output:

```bash
# From project root - use the run script
./scripts/run-release.sh

# Or run directly with logging enabled
cd /Users/mwangiiharun/projects/open-source/accelara
export ELECTRON_ENABLE_LOGGING=1
export ELECTRON_ENABLE_STACK_DUMPING=1
release/mac-arm64/ACCELARA.app/Contents/MacOS/ACCELARA 2>&1 | tee /tmp/accelara-console.log

# Or use open command with arguments
open -a release/mac-arm64/ACCELARA.app --args --enable-logging
```

This will show all console.log, console.error, and stderr output in real-time.
Logs are also saved to `/tmp/accelara-console.log` when using the script.

## Method 2: View Recent System Logs
View recent logs from the last 5 minutes:

```bash
log show --predicate 'process == "Electron" OR process == "ACCELARA" OR subsystem == "com.accelara.downloader"' --last 5m --style syslog
```

View logs from the last hour:
```bash
log show --predicate 'process == "Electron" OR process == "ACCELARA"' --last 1h --style syslog
```

## Method 3: Check Crash Report Files
macOS creates crash reports in:

```bash
# View recent crash reports
ls -lht ~/Library/Logs/DiagnosticReports/Electron* ~/Library/Logs/DiagnosticReports/ACCELARA* 2>/dev/null

# View the most recent crash report
cat ~/Library/Logs/DiagnosticReports/Electron_*.crash | head -100
```

## Method 4: Stream Live Logs
Watch logs in real-time as the app runs:

```bash
log stream --predicate 'process == "Electron" OR process == "ACCELARA"' --style syslog
```

Press Ctrl+C to stop streaming.

## Method 5: Use Console.app (GUI)
1. Open **Console.app** (Applications > Utilities > Console)
2. In the search box, type: `Electron` or `ACCELARA`
3. Filter by process name or subsystem
4. View crash reports in the left sidebar under "Crash Reports"

## Method 6: Check App-Specific Logs
If the app writes to specific log files:

```bash
# Check for any log files the app might create
find ~/Library/Logs -name "*accelara*" -o -name "*electron*" 2>/dev/null
```

## Quick Debug Command
Run this to see all relevant logs at once:

```bash
# View recent Electron/ACCELARA logs
log show --predicate 'process == "Electron" OR process == "ACCELARA"' --last 10m --style syslog | grep -i "error\|crash\|exception\|fatal" | tail -50
```

## Common Issues to Look For
- **"Go binary not found"** - The api-wrapper binary is missing
- **"ENOENT"** - File or path not found
- **"EPIPE"** - Broken pipe (usually non-fatal)
- **"SIGSEGV"** - Segmentation fault/crash
- **"Module not found"** - Missing dependency
- **Database errors** - SQLite issues

