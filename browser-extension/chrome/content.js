// ACCELARA Browser Extension - Content Script
// Captures magnet links and download links on web pages

(function() {
  'use strict';
  
  // Intercept magnet link clicks and navigation
  function interceptMagnetLink(url) {
    if (url && url.startsWith('magnet:')) {
      // Send to background script
      chrome.runtime.sendMessage({
        action: 'sendDownload',
        data: {
          type: 'magnet',
          url: url
        }
      });
      return true; // Indicate we handled it
    }
    return false;
  }
  
  // Intercept magnet link clicks
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="magnet:"]');
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      
      const magnetUrl = link.getAttribute('href');
      interceptMagnetLink(magnetUrl);
      
      return false;
    }
  }, true);
  
  // Intercept magnet links in navigation (e.g., direct URL bar entry)
  const originalPushState = history.pushState;
  history.pushState = function(...args) {
    if (args[2] && args[2].startsWith('magnet:')) {
      interceptMagnetLink(args[2]);
      return;
    }
    return originalPushState.apply(history, args);
  };
  
  const originalReplaceState = history.replaceState;
  history.replaceState = function(...args) {
    if (args[2] && args[2].startsWith('magnet:')) {
      interceptMagnetLink(args[2]);
      return;
    }
    return originalReplaceState.apply(history, args);
  };
  
  // Intercept window.location changes
  let currentUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      if (currentUrl.startsWith('magnet:')) {
        interceptMagnetLink(currentUrl);
        // Prevent navigation
        window.stop();
      }
    }
  }, 100);
  
  // Intercept right-click on links (context menu)
  document.addEventListener('contextmenu', (e) => {
    const link = e.target.closest('a[href]');
    if (link) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('magnet:')) {
        // Store for context menu handler
        link.setAttribute('data-accelara-magnet', href);
      }
    }
  });
  
  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'interceptDownload') {
      // Intercept a specific download
      const link = document.querySelector(`a[href="${request.url}"]`);
      if (link) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          chrome.runtime.sendMessage({
            action: 'sendDownload',
            data: {
              type: 'download',
              url: request.url,
              filename: request.filename
            }
          });
        }, { once: true });
      }
    }
    
    return true;
  });
})();

