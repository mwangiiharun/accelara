# ACCELARA Browser Extension

This browser extension allows ACCELARA to intercept downloads and magnet links from your web browser.

## Installation

### Chrome/Edge

1. Open Chrome/Edge and navigate to `chrome://extensions/` (or `edge://extensions/`)
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `browser-extension/chrome` folder
5. The extension should now be installed

### Firefox

1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox"
3. Click "Load Temporary Add-on"
4. Select the `manifest.json` file in the `browser-extension/firefox` folder

## Features

- **Automatic Interception**: Intercepts magnet links and downloads automatically
- **Smart Filtering**: Only intercepts large files (>100MB) or specific file types by default
- **Intercept All**: Option to intercept all downloads
- **Native Integration**: Communicates with ACCELARA via local HTTP server

## Configuration

Click the ACCELARA extension icon to open the popup and configure:
- **Enable Interception**: Toggle to enable/disable download interception
- **Intercept All Downloads**: Toggle to intercept all downloads (not just large files)

## How It Works

1. The extension monitors browser downloads and magnet link clicks
2. When a download/magnet link is detected, it sends a request to ACCELARA's local server (port 8765)
3. ACCELARA receives the request and opens the download dialog
4. The browser's default download is cancelled

## Troubleshooting

- **Downloads not being intercepted**: Make sure ACCELARA is running and the extension is enabled
- **Port already in use**: Another application may be using port 8765. Restart ACCELARA.
- **Extension not working**: Check browser console for errors (F12 → Console)

## Native Messaging (Optional)

For better integration, you can set up native messaging. This requires additional configuration files in your system.

### macOS
Place the native messaging host manifest at:
`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.mwangiiharun.accelara.json`

### Windows
Place at:
`HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.mwangiiharun.accelara`

### Linux
Place at:
`~/.config/google-chrome/NativeMessagingHosts/com.mwangiiharun.accelara.json`

