document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('refreshBtn');
  const projectsGrid = document.getElementById('projectsGrid');
  const projectSelector = document.getElementById('projectSelector');
  const configForm = document.getElementById('configForm');
  const tokenLimitInput = document.getElementById('tokenLimitInput');
  const projectActiveInput = document.getElementById('projectActiveInput');
  const logsBody = document.getElementById('logsBody');

  const newProjectFields = document.getElementById('newProjectFields');
  const newProjectIdInput = document.getElementById('newProjectIdInput');
  const newProjectNameInput = document.getElementById('newProjectNameInput');
  const submitConfigBtn = document.getElementById('submitConfigBtn');

  let localProjects = [];

  // Helper to copy text to clipboard with fallback
  function copyToClipboard(text) {
    const fallbackCopy = (val) => {
      return new Promise((resolve, reject) => {
        try {
          const textArea = document.createElement('textarea');
          textArea.value = val;
          // Keep outside of viewport and hidden but selectable
          textArea.style.position = 'fixed';
          textArea.style.top = '-9999px';
          textArea.style.left = '-9999px';
          textArea.setAttribute('readonly', '');
          document.body.appendChild(textArea);
          textArea.select();
          textArea.setSelectionRange(0, 99999); // For mobile devices
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
    await Promise.all([fetchProjects(), fetchLogs()]);
  }

  // Fetch Projects
  async function fetchProjects() {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (data.success) {
        localProjects = data.projects;
        renderProjects(data.projects);
        updateProjectSelector(data.projects);
      }
    } catch (err) {
      console.error('Error fetching projects:', err);
      projectsGrid.innerHTML = `<div class="loading-spinner">Error loading projects.</div>`;
    }
  }

  // Fetch Logs
  async function fetchLogs() {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      if (data.success) {
        renderLogs(data.logs);
      }
    } catch (err) {
      console.error('Error fetching logs:', err);
      logsBody.innerHTML = `<tr><td colspan="4" class="no-logs">Error loading logs.</td></tr>`;
    }
  }

  // Render Projects Grid
  function renderProjects(projects) {
    if (projects.length === 0) {
      projectsGrid.innerHTML = `<div class="loading-spinner">No projects registered.</div>`;
      return;
    }

    projectsGrid.innerHTML = '';
    projects.forEach(project => {
      const percentage = Math.min(((project.tokensUsed / project.tokenLimit) * 100), 100).toFixed(1);
      const isOverLimit = project.tokensUsed >= project.tokenLimit;
      const statusClass = project.isActive ? 'active' : 'suspended';
      const statusLabel = project.isActive ? 'Active' : 'Disabled';

      let progressColorClass = '';
      if (percentage >= 90) {
        progressColorClass = 'danger';
      } else if (percentage >= 75) {
        progressColorClass = 'warning';
      }

      const card = document.createElement('div');
      card.className = 'card project-card';
      
      const apiKeyHtml = project.apiKey 
        ? `
          <div class="api-key-box" style="margin-top: 1.25rem; padding: 0.75rem; background: rgba(0,0,0,0.25); border-radius: 0.5rem; font-size: 0.8125rem; border: 1px solid rgba(255,255,255,0.05);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <span style="color: var(--text-secondary);">API Key:</span>
              <code class="api-key-text" style="font-family: monospace; color: var(--accent-color); font-weight: 600;">${project.apiKey}</code>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <span style="color: var(--text-secondary);">Endpoint:</span>
              <code style="font-family: monospace; font-size: 0.75rem; color: var(--text-primary); max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${window.location.origin}/api/v1/projects/${project.projectId}">.../api/v1/projects/${project.projectId}</code>
            </div>
            <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
              <button class="btn btn-secondary btn-copy-key" data-key="${project.apiKey}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; flex: 1; justify-content: center;">
                📋 Copy Key
              </button>
              <button class="btn btn-secondary btn-copy-endpoint" data-endpoint="${window.location.origin}/api/v1/projects/${project.projectId}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; flex: 1; justify-content: center;">
                🔗 Copy Url
              </button>
            </div>
          </div>
        `
        : `
          <div class="api-key-box" style="margin-top: 1.25rem; padding: 0.75rem; background: rgba(0,0,0,0.25); border-radius: 0.5rem; font-size: 0.8125rem; border: 1px solid rgba(255,255,255,0.05); text-align: center;">
            <span style="color: var(--text-secondary); display: block; margin-bottom: 0.5rem;">No API Key generated.</span>
            <button class="btn btn-primary btn-generate-key" data-id="${project.projectId}" style="padding: 0.25rem 0.75rem; font-size: 0.75rem; margin: 0 auto; display: inline-flex;">
              🔑 Generate Key
            </button>
          </div>
        `;

      card.innerHTML = `
        <div class="project-card-header">
          <div class="project-title">
            <h3>${project.name}</h3>
            <span class="project-id">${project.projectId}</span>
          </div>
          <span class="status-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="progress-container">
          <div class="progress-labels">
            <span>Tokens Used: <span class="tokens-total">${project.tokensUsed.toLocaleString()}</span></span>
            <span>Limit: ${project.tokenLimit.toLocaleString()}</span>
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
          <button class="btn btn-danger btn-reset" data-id="${project.projectId}" style="flex: 1; justify-content: center;">
            Reset Tokens
          </button>
          <button class="btn btn-secondary btn-delete" data-id="${project.projectId}" style="color: var(--danger-color); border-color: rgba(239, 68, 68, 0.2); justify-content: center;">
            🗑️ Delete
          </button>
        </div>
      `;
      projectsGrid.appendChild(card);
    });

    // Wire up reset buttons
    document.querySelectorAll('.btn-reset').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const projectId = e.target.getAttribute('data-id');
        if (confirm(`Are you sure you want to reset the token usage counter for "${projectId}"?`)) {
          try {
            const res = await fetch('/api/projects/reset', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectId })
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
    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const projectId = e.currentTarget.getAttribute('data-id');
        if (confirm(`⚠️ Are you sure you want to DELETE project "${projectId}"?\nThis will permanently delete the project and all its completions logs. This action cannot be undone.`)) {
          try {
            const res = await fetch(`/api/projects/${projectId}`, {
              method: 'DELETE'
            });
            const data = await res.json();
            if (data.success) {
              alert('Project deleted successfully.');
              
              // If deleted project was currently selected in config panel, reset selector
              if (projectSelector.value === projectId) {
                projectSelector.value = '';
                projectSelector.dispatchEvent(new Event('change'));
              }
              
              loadData();
            } else {
              alert('Error deleting project: ' + data.error);
            }
          } catch (err) {
            alert('Failed to execute delete operation.');
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

    // Wire up generate key buttons
    document.querySelectorAll('.btn-generate-key').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const projectId = e.currentTarget.getAttribute('data-id');
        try {
          const res = await fetch(`/api/projects/${projectId}/key`, {
            method: 'POST'
          });
          const data = await res.json();
          if (data.success) {
            alert('API Key generated successfully.');
            loadData();
          } else {
            alert('Error generating key: ' + data.error);
          }
        } catch (err) {
          alert('Failed to generate API key.');
        }
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
        <td class="log-project">${log.projectId}</td>
        <td class="log-tokens">${log.totalTokens.toLocaleString()}</td>
        <td><span class="log-model">${log.modelName}</span></td>
        <td class="log-time">${timeString}</td>
      `;
      logsBody.appendChild(row);
    });
  }

  // Update Config Dropdown
  function updateProjectSelector(projects) {
    const currentSelected = projectSelector.value;
    projectSelector.innerHTML = `
      <option value="" disabled selected>Choose a project...</option>
      <option value="new" style="font-weight: bold; color: var(--primary-color);">+ Add New Project</option>
    `;
    
    projects.forEach(project => {
      const opt = document.createElement('option');
      opt.value = project.projectId;
      opt.textContent = `${project.name} (${project.projectId})`;
      projectSelector.appendChild(opt);
    });

    if (currentSelected) {
      projectSelector.value = currentSelected;
    }
  }

  // Handle Selector Change (prefill inputs or toggle new fields)
  projectSelector.addEventListener('change', (e) => {
    const selectedId = e.target.value;
    if (selectedId === 'new') {
      newProjectFields.style.display = 'block';
      newProjectIdInput.required = true;
      newProjectNameInput.required = true;
      newProjectIdInput.value = '';
      newProjectNameInput.value = '';
      tokenLimitInput.value = '500000';
      projectActiveInput.checked = true;
      submitConfigBtn.textContent = 'Create Project';
    } else {
      newProjectFields.style.display = 'none';
      newProjectIdInput.required = false;
      newProjectNameInput.required = false;
      submitConfigBtn.textContent = 'Update Configuration';
      const project = localProjects.find(p => p.projectId === selectedId);
      if (project) {
        tokenLimitInput.value = project.tokenLimit;
        projectActiveInput.checked = project.isActive;
      }
    }
  });

  // Handle Config Form Submit
  configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const selectedValue = projectSelector.value;
    let projectId = selectedValue;
    let name = '';
    const tokenLimit = parseInt(tokenLimitInput.value, 10);
    const isActive = projectActiveInput.checked;

    if (selectedValue === 'new') {
      projectId = newProjectIdInput.value.trim();
      name = newProjectNameInput.value.trim();
      if (!projectId || !name) {
        alert('Please fill in both the Project ID and Project Name.');
        return;
      }
    } else {
      const project = localProjects.find(p => p.projectId === projectId);
      name = project ? project.name : projectId;
    }

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, name, tokenLimit, isActive })
      });
      const data = await res.json();
      if (data.success) {
        alert(selectedValue === 'new' ? 'Project created successfully.' : 'Configuration saved successfully.');
        
        // Reset form inputs & styles
        newProjectFields.style.display = 'none';
        newProjectIdInput.required = false;
        newProjectNameInput.required = false;
        submitConfigBtn.textContent = 'Update Configuration';
        
        // Refresh and select the newly created or updated project
        await loadData();
        projectSelector.value = projectId;
        // Trigger selection change to update inputs
        projectSelector.dispatchEvent(new Event('change'));
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
