// ACCELARA Browser Extension - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggleEnabled');
  const toggleInterceptAll = document.getElementById('toggleInterceptAll');
  const status = document.getElementById('status');
  
  // Load current status
  browser.runtime.sendMessage({ action: 'getStatus' }).then((response) => {
    if (response) {
      updateToggle(toggleEnabled, response.enabled);
      updateToggle(toggleInterceptAll, response.interceptAll);
      updateStatus(response.enabled);
    }
  }).catch(() => {});
  
  // Toggle enabled
  toggleEnabled.addEventListener('click', () => {
    browser.runtime.sendMessage({ action: 'toggle' }).then((response) => {
      if (response) {
        updateToggle(toggleEnabled, response.enabled);
        updateStatus(response.enabled);
      }
    }).catch(() => {});
  });
  
  // Toggle intercept all
  toggleInterceptAll.addEventListener('click', () => {
    browser.runtime.sendMessage({ action: 'getStatus' }).then((response) => {
      if (response) {
        const newValue = !response.interceptAll;
        browser.runtime.sendMessage({ 
          action: 'setInterceptAll', 
          value: newValue 
        }).then((result) => {
          if (result && result.success) {
            updateToggle(toggleInterceptAll, newValue);
          }
        }).catch(() => {});
      }
    }).catch(() => {});
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

