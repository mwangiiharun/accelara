// ACCELARA Browser Extension - Background Service Worker
// Intercepts downloads and sends them to ACCELARA

const ACCELARA_HOST = 'localhost';
const ACCELARA_PORT = 8765; // Default port for ACCELARA local server

let isEnabled = true;
let interceptAll = false;

// Load settings from storage
chrome.storage.sync.get(['enabled', 'interceptAll'], (result) => {
  isEnabled = result.enabled !== false; // Default to enabled
  interceptAll = result.interceptAll === true;
});

// Listen for download events
chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!isEnabled) return;
  
  const url = downloadItem.url;
  const filename = downloadItem.filename || downloadItem.suggestedFilename;
  
  // Check if we should intercept this download
  if (!shouldIntercept(url, downloadItem)) {
    return;
  }
  
  // Cancel the browser download
  chrome.downloads.cancel(downloadItem.id, () => {
    // Send to ACCELARA
    sendToAccelara({
      type: 'download',
      url: url,
      filename: filename,
      referrer: downloadItem.referrer,
      mimeType: downloadItem.mime
    });
  });
});

// Note: webRequestBlocking is not available in Manifest V3
// Magnet links are intercepted via content script (content.js) which handles click events

// Check if we should intercept a download
function shouldIntercept(url, downloadItem) {
  // Always intercept magnet links
  if (url.startsWith('magnet:')) {
    return true;
  }
  
  // If interceptAll is enabled, intercept everything
  if (interceptAll) {
    return true;
  }
  
  // Intercept large files (>100MB) by default
  if (downloadItem.totalBytes && downloadItem.totalBytes > 100 * 1024 * 1024) {
    return true;
  }
  
  // Intercept common download file types
  const urlLower = url.toLowerCase();
  const extensions = ['.torrent', '.zip', '.rar', '.7z', '.tar', '.gz', '.iso', '.dmg', '.exe', '.msi', '.deb', '.rpm', '.appimage'];
  if (extensions.some(ext => urlLower.includes(ext))) {
    return true;
  }
  
  return false;
}

// Send download request to ACCELARA
function sendToAccelara(data) {
  // Try native messaging first
  try {
    const port = chrome.runtime.connectNative('com.mwangiiharun.accelara');
    port.postMessage(data);
    port.onDisconnect.addListener(() => {
      // If native messaging fails, try HTTP
      if (chrome.runtime.lastError) {
        sendToAccelaraHTTP(data);
      }
    });
  } catch (error) {
    // Fallback to HTTP
    sendToAccelaraHTTP(data);
  }
}

// Send download request via HTTP (fallback)
function sendToAccelaraHTTP(data) {
  fetch(`http://${ACCELARA_HOST}:${ACCELARA_PORT}/download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  }).catch(error => {
    console.error('Failed to send to ACCELARA:', error);
    // Show notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'ACCELARA',
      message: 'Failed to connect to ACCELARA. Make sure the app is running.'
    });
  });
}

// Listen for messages from popup/content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggle') {
    isEnabled = !isEnabled;
    chrome.storage.sync.set({ enabled: isEnabled });
    sendResponse({ enabled: isEnabled });
  } else if (request.action === 'setInterceptAll') {
    interceptAll = request.value;
    chrome.storage.sync.set({ interceptAll: interceptAll });
    sendResponse({ success: true });
  } else if (request.action === 'getStatus') {
    sendResponse({ enabled: isEnabled, interceptAll: interceptAll });
  } else if (request.action === 'sendDownload') {
    sendToAccelara(request.data);
    sendResponse({ success: true });
  }
  
  return true; // Keep channel open for async response
});

