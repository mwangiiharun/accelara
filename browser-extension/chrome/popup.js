// ACCELARA Browser Extension - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggleEnabled');
  const toggleInterceptAll = document.getElementById('toggleInterceptAll');
  const status = document.getElementById('status');
  
  // Load current status
  chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    if (response) {
      updateToggle(toggleEnabled, response.enabled);
      updateToggle(toggleInterceptAll, response.interceptAll);
      updateStatus(response.enabled);
    }
  });
  
  // Toggle enabled
  toggleEnabled.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'toggle' }, (response) => {
      if (response) {
        updateToggle(toggleEnabled, response.enabled);
        updateStatus(response.enabled);
      }
    });
  });
  
  // Toggle intercept all
  toggleInterceptAll.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
      if (response) {
        const newValue = !response.interceptAll;
        chrome.runtime.sendMessage({ 
          action: 'setInterceptAll', 
          value: newValue 
        }, (result) => {
          if (result && result.success) {
            updateToggle(toggleInterceptAll, newValue);
          }
        });
      }
    });
  });
  
  function updateToggle(element, active) {
    if (active) {
      element.classList.add('active');
    } else {
      element.classList.remove('active');
    }
  }
  
  function updateStatus(enabled) {
    if (enabled) {
      status.textContent = '✓ Interception enabled';
      status.style.color = '#4CAF50';
    } else {
      status.textContent = '✗ Interception disabled';
      status.style.color = '#999';
    }
  }
});

