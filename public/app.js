document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('refreshBtn');
  const clientsGrid = document.getElementById('clientsGrid');
  const clientSelector = document.getElementById('clientSelector');
  const configForm = document.getElementById('configForm');
  const tokenLimitInput = document.getElementById('tokenLimitInput');
  const resetCycleInput = document.getElementById('resetCycleInput');
  const clientActiveInput = document.getElementById('clientActiveInput');
  const logsBody = document.getElementById('logsBody');

  const newClientFields = document.getElementById('newClientFields');
  const newClientIdInput = document.getElementById('newClientIdInput');
  const newClientNameInput = document.getElementById('newClientNameInput');
  const submitConfigBtn = document.getElementById('submitConfigBtn');

  let localClients = [];

  // Helper to copy text to clipboard with fallback
  function copyToClipboard(text) {
    const fallbackCopy = (val) => {
      return new Promise((resolve, reject) => {
        try {
          const textArea = document.createElement('textarea');
          textArea.value = val;
          textArea.style.position = 'fixed';
          textArea.style.top = '-9999px';
          textArea.style.left = '-9999px';
          textArea.setAttribute('readonly', '');
          document.body.appendChild(textArea);
          textArea.select();
          textArea.setSelectionRange(0, 99999);
          const successful = document.execCommand('copy');
          document.body.removeChild(textArea);
          if (successful) resolve();
          else reject(new Error('execCommand copy failed'));
        } catch (err) {
          reject(err);
        }
      });
    };

    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch((err) => {
        console.warn('navigator.clipboard failed, attempting fallback...', err);
        return fallbackCopy(text);
      });
    } else {
      return fallbackCopy(text);
    }
  }

  // Load everything
  async function loadData() {
    await Promise.all([fetchClients(), fetchLogs()]);
  }

  // Fetch Clients
  async function fetchClients() {
    try {
      const res = await fetch('/api/admin/clients');
      const data = await res.json();
      if (data.success) {
        localClients = data.clients;
        renderClients(data.clients);
        updateClientSelector(data.clients);
      }
    } catch (err) {
      console.error('Error fetching clients:', err);
      clientsGrid.innerHTML = `<div class="loading-spinner">Error loading clients.</div>`;
    }
  }

  // Fetch Audit Logs
  async function fetchLogs() {
    try {
      const res = await fetch('/api/admin/logs');
      const data = await res.json();
      if (data.success) {
        renderLogs(data.logs);
      }
    } catch (err) {
      console.error('Error fetching logs:', err);
      logsBody.innerHTML = `<tr><td colspan="4" class="no-logs">Error loading logs.</td></tr>`;
    }
  }

  // Render Clients Grid
  function renderClients(clients) {
    if (clients.length === 0) {
      clientsGrid.innerHTML = `<div class="loading-spinner">No clients registered.</div>`;
      return;
    }

    clientsGrid.innerHTML = '';
    clients.forEach(client => {
      const percentage = Math.min(((client.tokensUsed / client.tokenLimit) * 100), 100).toFixed(1);
      const isOverLimit = client.tokensUsed >= client.tokenLimit;
      const statusClass = client.isActive ? 'active' : 'suspended';
      const statusLabel = client.isActive ? 'Active' : 'Disabled';

      let progressColorClass = '';
      if (percentage >= 90) {
        progressColorClass = 'danger';
      } else if (percentage >= 75) {
        progressColorClass = 'warning';
      }

      const card = document.createElement('div');
      card.className = 'card project-card';
      
      const apiKeyHtml = client.apiKey 
        ? `
          <div class="api-key-box" style="margin-top: 1.25rem; padding: 0.75rem; background: rgba(0,0,0,0.25); border-radius: 0.5rem; font-size: 0.8125rem; border: 1px solid rgba(255,255,255,0.05);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <span style="color: var(--text-secondary);">API Key:</span>
              <code class="api-key-text" style="font-family: monospace; color: var(--accent-color); font-weight: 600;">${client.apiKey}</code>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <span style="color: var(--text-secondary);">Endpoint:</span>
              <code style="font-family: monospace; font-size: 0.75rem; color: var(--text-primary); max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${window.location.origin}/api/v1/clients/${client.clientId}">.../api/v1/clients/${client.clientId}</code>
            </div>
            <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
              <button class="btn btn-secondary btn-copy-key" data-key="${client.apiKey}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; flex: 1; justify-content: center;">
                📋 Copy Key
              </button>
              <button class="btn btn-secondary btn-copy-endpoint" data-endpoint="${window.location.origin}/api/v1/clients/${client.clientId}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; flex: 1; justify-content: center;">
                🔗 Copy Url
              </button>
            </div>
            <button class="btn btn-secondary btn-rotate-key" data-id="${client.clientId}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; width: 100%; margin-top: 0.5rem; justify-content: center;">
              🔄 Rotate API Key
            </button>
          </div>
        `
        : `
          <div class="api-key-box" style="margin-top: 1.25rem; padding: 0.75rem; background: rgba(0,0,0,0.25); border-radius: 0.5rem; font-size: 0.8125rem; border: 1px solid rgba(255,255,255,0.05); text-align: center;">
            <span style="color: var(--text-secondary); display: block; margin-bottom: 0.5rem;">No API Key generated.</span>
            <button class="btn btn-primary btn-rotate-key" data-id="${client.clientId}" style="padding: 0.25rem 0.75rem; font-size: 0.75rem; margin: 0 auto; display: inline-flex;">
              🔑 Generate Key
            </button>
          </div>
        `;

      card.innerHTML = `
        <div class="project-card-header">
          <div class="project-title">
            <h3>${client.name}</h3>
            <span class="project-id">${client.clientId} <span style="font-size: 0.7rem; color: var(--text-secondary); font-style: italic;">(${client.resetCycle} reset)</span></span>
          </div>
          <span class="status-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="progress-container">
          <div class="progress-labels">
            <span>Tokens Used: <span class="tokens-total">${client.tokensUsed.toLocaleString()}</span></span>
            <span>Limit: ${client.tokenLimit.toLocaleString()}</span>
          </div>
          <div class="progress-track">
            <div class="progress-bar ${progressColorClass}" style="width: ${percentage}%"></div>
          </div>
          <div class="progress-labels" style="margin-top: 0.5rem; font-size: 0.75rem;">
            <span>${percentage}% Consumed</span>
            ${isOverLimit ? '<span style="color: var(--danger-color); font-weight:600;">LIMIT REACHED</span>' : ''}
          </div>
        </div>
        ${apiKeyHtml}
        <div class="project-card-footer" style="margin-top: 1.25rem; display: flex; justify-content: space-between; gap: 0.5rem;">
          <button class="btn btn-danger btn-reset-tokens" data-id="${client.clientId}" style="flex: 1; justify-content: center;">
            Reset Tokens
          </button>
          <button class="btn btn-secondary btn-delete-client" data-id="${client.clientId}" style="color: var(--danger-color); border-color: rgba(239, 68, 68, 0.2); justify-content: center;">
            🗑️ Delete
          </button>
        </div>
      `;
      clientsGrid.appendChild(card);
    });

    // Wire up reset token buttons
    document.querySelectorAll('.btn-reset-tokens').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const clientId = e.target.getAttribute('data-id');
        if (confirm(`Are you sure you want to reset token usage for client "${clientId}"?`)) {
          try {
            const res = await fetch(`/api/admin/clients/${clientId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ resetTokens: true })
            });
            const data = await res.json();
            if (data.success) {
              alert('Token usage reset successfully.');
              loadData();
            } else {
              alert('Error resetting tokens: ' + data.error);
            }
          } catch (err) {
            alert('Failed to execute reset operation.');
          }
        }
      });
    });

    // Wire up delete buttons
    document.querySelectorAll('.btn-delete-client').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const clientId = e.currentTarget.getAttribute('data-id');
        if (confirm(`⚠️ Are you sure you want to DELETE client "${clientId}"?\nThis will permanently delete the client and all their completions logs. This action cannot be undone.`)) {
          try {
            const res = await fetch(`/api/admin/clients/${clientId}`, {
              method: 'DELETE'
            });
            const data = await res.json();
            if (data.success) {
              alert('Client deleted successfully.');
              
              // If deleted client was currently selected in config panel, reset selector
              if (clientSelector.value === clientId) {
                clientSelector.value = '';
                clientSelector.dispatchEvent(new Event('change'));
              }
              
              loadData();
            } else {
              alert('Error deleting client: ' + data.error);
            }
          } catch (err) {
            alert('Failed to execute delete operation.');
          }
        }
      });
    });

    // Wire up rotate API Key buttons
    document.querySelectorAll('.btn-rotate-key').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const clientId = e.currentTarget.getAttribute('data-id');
        if (confirm(`🔄 Are you sure you want to rotate the API Key for client "${clientId}"?\nAny application using the old API Key will immediately fail to authenticate.`)) {
          try {
            const res = await fetch(`/api/admin/clients/${clientId}/rotate-key`, {
              method: 'POST'
            });
            const data = await res.json();
            if (data.success) {
              alert(`API Key rotated successfully.\n\nNew Key: ${data.apiKey}`);
              loadData();
            } else {
              alert('Error rotating key: ' + data.error);
            }
          } catch (err) {
            alert('Failed to rotate API key.');
          }
        }
      });
    });

    // Wire up copy key buttons
    document.querySelectorAll('.btn-copy-key').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const button = e.currentTarget;
        const key = button.getAttribute('data-key');
        copyToClipboard(key)
          .then(() => {
            const originalText = button.innerHTML;
            button.innerHTML = '✅ Copied!';
            setTimeout(() => { button.innerHTML = originalText; }, 2000);
          })
          .catch((err) => alert('Failed to copy API key: ' + err.message));
      });
    });

    // Wire up copy endpoint buttons
    document.querySelectorAll('.btn-copy-endpoint').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const button = e.currentTarget;
        const endpoint = button.getAttribute('data-endpoint');
        copyToClipboard(endpoint)
          .then(() => {
            const originalText = button.innerHTML;
            button.innerHTML = '✅ Copied!';
            setTimeout(() => { button.innerHTML = originalText; }, 2000);
          })
          .catch((err) => alert('Failed to copy endpoint URL: ' + err.message));
      });
    });
  }

  // Render Table Logs
  function renderLogs(logs) {
    if (logs.length === 0) {
      logsBody.innerHTML = `<tr><td colspan="4" class="no-logs">No logged requests found.</td></tr>`;
      return;
    }

    logsBody.innerHTML = '';
    logs.forEach(log => {
      const row = document.createElement('tr');
      const timeString = new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      row.innerHTML = `
        <td class="log-project">${log.clientId}</td>
        <td class="log-tokens">${log.totalTokens.toLocaleString()}</td>
        <td><span class="log-model">${log.modelName}</span></td>
        <td class="log-time">${timeString}</td>
      `;
      logsBody.appendChild(row);
    });
  }

  // Update Config Dropdown
  function updateClientSelector(clients) {
    const currentSelected = clientSelector.value;
    clientSelector.innerHTML = `
      <option value="" disabled selected>Choose a client...</option>
      <option value="new" style="font-weight: bold; color: var(--primary-color);">+ Add New Client</option>
    `;
    
    clients.forEach(client => {
      const opt = document.createElement('option');
      opt.value = client.clientId;
      opt.textContent = `${client.name} (${client.clientId})`;
      clientSelector.appendChild(opt);
    });

    if (currentSelected) {
      clientSelector.value = currentSelected;
    }
  }

  // Handle Selector Change (prefill inputs or toggle new fields)
  clientSelector.addEventListener('change', (e) => {
    const selectedId = e.target.value;
    if (selectedId === 'new') {
      newClientFields.style.display = 'block';
      newClientIdInput.required = true;
      newClientNameInput.required = true;
      newClientIdInput.value = '';
      newClientNameInput.value = '';
      tokenLimitInput.value = '1000000';
      resetCycleInput.value = 'monthly';
      clientActiveInput.checked = true;
      submitConfigBtn.textContent = 'Create Client';
    } else {
      newClientFields.style.display = 'none';
      newClientIdInput.required = false;
      newClientNameInput.required = false;
      submitConfigBtn.textContent = 'Update Configuration';
      const client = localClients.find(c => c.clientId === selectedId);
      if (client) {
        tokenLimitInput.value = client.tokenLimit;
        resetCycleInput.value = client.resetCycle || 'monthly';
        clientActiveInput.checked = client.isActive;
      }
    }
  });

  // Handle Config Form Submit
  configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const selectedValue = clientSelector.value;
    let clientId = selectedValue;
    let name = '';
    const tokenLimit = parseInt(tokenLimitInput.value, 10);
    const resetCycle = resetCycleInput.value;
    const isActive = clientActiveInput.checked;

    if (selectedValue === 'new') {
      clientId = newClientIdInput.value.trim();
      name = newClientNameInput.value.trim();
      if (!clientId || !name) {
        alert('Please fill in both the Client ID and Client Name.');
        return;
      }
    } else {
      const client = localClients.find(c => c.clientId === clientId);
      name = client ? client.name : clientId;
    }

    try {
      const url = selectedValue === 'new' ? '/api/admin/clients' : `/api/admin/clients/${clientId}`;
      const method = selectedValue === 'new' ? 'POST' : 'PATCH';
      
      const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, name, tokenLimit, isActive, resetCycle })
      });
      const data = await res.json();
      if (data.success) {
        alert(selectedValue === 'new' ? 'Client created successfully.' : 'Configuration saved successfully.');
        
        // Reset form inputs & styles
        newClientFields.style.display = 'none';
        newClientIdInput.required = false;
        newClientNameInput.required = false;
        submitConfigBtn.textContent = 'Update Configuration';
        
        // Refresh and select the newly created or updated client
        await loadData();
        clientSelector.value = clientId;
        clientSelector.dispatchEvent(new Event('change'));
      } else {
        alert('Failed to save configuration: ' + data.error);
      }
    } catch (err) {
      alert('Error connecting to the proxy backend.');
    }
  });

  // Handle Refresh Action
  refreshBtn.addEventListener('click', () => {
    loadData();
  });

  // Initial Load
  loadData();
});
