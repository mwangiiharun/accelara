# Viewing Go Logs

This document explains how to view Go backend logs and exceptions.

## Quick Start: Tail Go Logs in Dev Mode

When running in dev mode, all Go errors are automatically written to a log file:

```bash
# In one terminal, start the app
npm run dev

# In another terminal, tail the Go logs
./scripts/tail-go-logs.sh
```

The log file is located at: `~/.accelara/logs/go-errors-*.log`

## Method 1: Tail Go Log File (Dev Mode - Recommended)

When running in **dev mode**, all Go errors are automatically written to a log file that you can tail:

1. Start the app in dev mode:
   ```bash
   npm run dev
   ```

2. In another terminal, tail the log file:
   ```bash
   ./scripts/tail-go-logs.sh
   ```

   Or manually:
   ```bash
   tail -f ~/.accelara/logs/go-errors-*.log
   ```

The log file includes:
- Timestamp for each error
- Download ID or process tag
- Full error message
- Auto-recovery messages (like chunk client timeouts)

**Log file location**: `~/.accelara/logs/go-errors-{timestamp}.log`

## Method 2: View Logs in Electron Console

When running the Electron app, all Go errors and exceptions are automatically logged to the console with clear formatting:

```
═══════════════════════════════════════════════════════════
[download-id] Go Error/Exception:
  Error message here
═══════════════════════════════════════════════════════════
```

### In Development Mode

1. Start the app in dev mode:
   ```bash
   npm run dev
   ```

2. Open the Developer Tools:
   - **macOS**: `Cmd + Option + I` or `View > Toggle Developer Tools`
   - **Windows/Linux**: `Ctrl + Shift + I` or `View > Toggle Developer Tools`

3. Go to the **Console** tab to see all Go errors and logs.

### In Release Mode

1. Run the packaged app with logging enabled:
   ```bash
   ./scripts/run-release.sh
   ```

2. Or run directly with logging:
   ```bash
   ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1 \
     /path/to/ACCELARA.app/Contents/MacOS/ACCELARA 2>&1 | tee /tmp/accelara-logs.txt
   ```

3. View logs in real-time or check `/tmp/accelara-logs.txt` after the app closes.

## Method 3: Run Go Binary Directly

To test the Go backend independently and see all logs:

1. Build the Go binary:
   ```bash
   make build-api
   ```

2. Run the helper script:
   ```bash
   ./scripts/run-go-binary.sh
   ```

3. Or run the binary directly:
   ```bash
   # Test HTTP download
   ./bin/api-wrapper --source 'https://example.com/file.zip' --output ~/Downloads

   # Test torrent download
   ./bin/api-wrapper --source 'magnet:?xt=urn:btih:...' --output ~/Downloads

   # Inspect torrent
   ./bin/api-wrapper --inspect --source 'magnet:?xt=urn:btih:...'

   # Run speed test
   ./bin/api-wrapper --speedtest --test-type full
   ```

All stdout and stderr from the Go binary will be displayed directly in your terminal.

## Method 4: View Logs from Packaged Binary

If you want to test the Go binary from a packaged release:

```bash
# macOS
./release/mac-arm64/ACCELARA.app/Contents/Resources/bin/api-wrapper \
  --source 'https://example.com/file.zip' \
  --output ~/Downloads

# Or extract and run
cd release/mac-arm64/ACCELARA.app/Contents/Resources/bin
./api-wrapper --help
```

## Log Format

Go errors appear in the console with this format:

- **Download ID**: Identifies which download the error belongs to
- **Error Message**: The actual error from Go
- **Visual Separator**: Makes errors easy to spot in console output

Example:
```
═══════════════════════════════════════════════════════════
[1762852403903-k4hjxhkxe] Go Error/Exception:
  failed to create torrent client: first listen: listen tcp4 :42069: bind: address already in use
═══════════════════════════════════════════════════════════
```

## Common Issues

### No logs appearing?

1. Check that the app is running in dev mode or with logging enabled
2. Ensure Developer Tools are open (in dev mode)
3. Check the terminal where you started the app (for release mode with logging)

### Want more verbose Go logging?

The Go binary logs errors to stderr automatically. To see more detailed logs, you can:

1. Modify `cmd/api-wrapper/main.go` to add more logging
2. Use Go's built-in logging: `log.Printf()`, `log.Fatalf()`, etc.
3. All Go stderr output is automatically captured and displayed in the Electron console

## Debugging Tips

1. **Check console first**: Most Go errors appear in the Electron console
2. **Run binary directly**: Use `./scripts/run-go-binary.sh` to isolate Go issues
3. **Check download ID**: Each error is tagged with a download ID for easy tracking
4. **Look for patterns**: Multiple errors with the same message indicate a recurring issue

