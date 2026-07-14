document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('refreshBtn');
  const projectsGrid = document.getElementById('projectsGrid');
  const projectSelector = document.getElementById('projectSelector');
  const configForm = document.getElementById('configForm');
  const tokenLimitInput = document.getElementById('tokenLimitInput');
  const projectActiveInput = document.getElementById('projectActiveInput');
  const logsBody = document.getElementById('logsBody');

  let localProjects = [];

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
        <div class="project-card-footer">
          <button class="btn btn-danger btn-reset" data-id="${project.projectId}">
            Reset Tokens
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
    projectSelector.innerHTML = '<option value="" disabled selected>Choose a project...</option>';
    
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

  // Handle Selector Change (prefill inputs)
  projectSelector.addEventListener('change', (e) => {
    const selectedId = e.target.value;
    const project = localProjects.find(p => p.projectId === selectedId);
    if (project) {
      tokenLimitInput.value = project.tokenLimit;
      projectActiveInput.checked = project.isActive;
    }
  });

  // Handle Config Form Submit
  configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const projectId = projectSelector.value;
    const tokenLimit = parseInt(tokenLimitInput.value, 10);
    const isActive = projectActiveInput.checked;
    const project = localProjects.find(p => p.projectId === projectId);
    const name = project ? project.name : projectId;

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, name, tokenLimit, isActive })
      });
      const data = await res.json();
      if (data.success) {
        alert('Configuration saved successfully.');
        loadData();
      } else {
        alert('Failed to update config: ' + data.error);
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
