// popup.js — Gravity v3 (MV3 compatible)
const debugDot  = document.getElementById('debugDot');
const debugText = document.getElementById('debugText');
const mcpDot    = document.getElementById('mcpDot');
const mcpText   = document.getElementById('mcpText');
const toggleBtn = document.getElementById('toggleBtn');
const errorMsg  = document.getElementById('errorMsg');

function setDot(dot, text, state, label) {
  dot.className = 'dot ' + state;
  text.textContent = label;
}

function showError(msg) {
  errorMsg.style.display = msg ? 'block' : 'none';
  errorMsg.textContent = msg || '';
}

function render(status) {
  showError(null);

  // Debugger row
  if (status.attached && status.domainsEnabled) {
    setDot(debugDot, debugText, 'green', `Tab ${status.tabId}`);
  } else if (status.attached) {
    setDot(debugDot, debugText, 'yellow', 'Attaching…');
  } else {
    setDot(debugDot, debugText, 'red', 'Disconnected');
    if (status.lastError) showError(status.lastError);
  }

  // MCP server row
  if (status.wsConnected) {
    setDot(mcpDot, mcpText, 'green', 'Connected');
  } else {
    setDot(mcpDot, mcpText, 'red', 'Not running');
  }

  // Button
  if (status.attached) {
    toggleBtn.textContent = 'Disconnect';
    toggleBtn.classList.add('disconnect');
  } else {
    toggleBtn.textContent = 'Connect to Tab';
    toggleBtn.classList.remove('disconnect');
  }
}

function refresh() {
  // In MV3, sendMessage may fail if SW is sleeping — retry once
  chrome.runtime.sendMessage({ action: 'status' }, (status) => {
    if (chrome.runtime.lastError) {
      // SW waking up — retry after short delay
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'status' }, (s) => {
          if (!chrome.runtime.lastError && s) render(s);
        });
      }, 300);
      return;
    }
    if (status) render(status);
  });
}

toggleBtn.addEventListener('click', () => {
  toggleBtn.disabled = true;
  chrome.runtime.sendMessage({ action: 'status' }, (status) => {
    const action = (status && status.attached) ? 'detach' : 'attach';
    chrome.runtime.sendMessage({ action }, (response) => {
      toggleBtn.disabled = false;
      if (response && !response.success && response.error) showError(response.error);
      refresh();
    });
  });
});

// Listen for real-time status pushes from SW (ws_status_update)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'ws_status_update') refresh();
  if (msg.action === 'debugger_detached') refresh();
});

refresh();
setInterval(refresh, 2000);
