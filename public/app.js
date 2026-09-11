document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('refreshBtn');
  const projectsGrid = document.getElementById('projectsGrid');
  const projectSelector = document.getElementById('projectSelector');
  const configForm = document.getElementById('configForm');
  const tokenLimitInput = document.getElementById('tokenLimitInput');
  const projectActiveInput = document.getElementById('projectActiveInput');
  const logsBody = document.getElementById('logsBody');

  // Logs Filtering & Pagination DOM Elements
  const logFilter = document.getElementById('logFilter');
  const pageInfo = document.getElementById('pageInfo');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');

  let localProjects = [];
  let localLogs = [];
  let currentPage = 1;
  const pageSize = 10;

  // Load everything
  async function loadData() {
    await Promise.all([fetchProjects(), fetchLogs()]);
  }

  // Fetch Projects
  async function fetchProjects() {
    try {
      projectsGrid.innerHTML = `<div class="loading-spinner">Loading projects...</div>`;
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (data.success) {
        localProjects = data.projects;
        renderProjects(data.projects);
        updateProjectSelector(data.projects);
      } else {
        const msg = data.error || 'Unknown server error';
        projectsGrid.innerHTML = `
          <div style="text-align:center; padding: 2rem; color: var(--danger-color);">
            <div style="font-size:2rem; margin-bottom:0.5rem;">⚠️</div>
            <strong>Failed to load projects</strong>
            <p style="margin:0.5rem 0; color: var(--text-secondary); font-size:0.85rem;">${msg}</p>
            <button onclick="location.reload()" style="margin-top:0.75rem; padding:0.4rem 1rem; background: var(--primary-color); color:#fff; border:none; border-radius:0.4rem; cursor:pointer;">Retry</button>
          </div>`;
      }
    } catch (err) {
      console.error('Error fetching projects:', err);
      projectsGrid.innerHTML = `
        <div style="text-align:center; padding: 2rem; color: var(--danger-color);">
          <div style="font-size:2rem; margin-bottom:0.5rem;">🔌</div>
          <strong>Cannot connect to server</strong>
          <p style="margin:0.5rem 0; color: var(--text-secondary); font-size:0.85rem;">Make sure the backend is running.</p>
          <button onclick="location.reload()" style="margin-top:0.75rem; padding:0.4rem 1rem; background: var(--primary-color); color:#fff; border:none; border-radius:0.4rem; cursor:pointer;">Retry</button>
        </div>`;
    }
  }

  // Fetch Logs
  async function fetchLogs() {
    try {
      logsBody.innerHTML = `<tr><td colspan="4" class="no-logs">Loading logs...</td></tr>`;
      const res = await fetch('/api/logs');
      const data = await res.json();
      if (data.success) {
        localLogs = data.logs;
        updateLogFilterSelector(data.logs);
        renderFilteredAndPaginatedLogs();
      } else {
        const msg = data.error || 'Unknown server error';
        logsBody.innerHTML = `<tr><td colspan="4" class="no-logs" style="color: var(--danger-color);">⚠️ ${msg}</td></tr>`;
      }
    } catch (err) {
      console.error('Error fetching logs:', err);
      logsBody.innerHTML = `<tr><td colspan="4" class="no-logs" style="color: var(--danger-color);">🔌 Cannot connect to server.</td></tr>`;
    }
  }

  // Populate Unique Log Project Selector
  function updateLogFilterSelector(logs) {
    const currentVal = logFilter.value;
    const uniqueProjects = [...new Set(logs.map(log => log.projectId))];
    
    logFilter.innerHTML = '<option value="all">All Projects</option>';
    uniqueProjects.forEach(projId => {
      const opt = document.createElement('option');
      opt.value = projId;
      opt.textContent = projId;
      logFilter.appendChild(opt);
    });
    
    if (uniqueProjects.includes(currentVal)) {
      logFilter.value = currentVal;
    } else {
      logFilter.value = 'all';
    }
  }

  // Filter and Paginate Logs Client Side
  function renderFilteredAndPaginatedLogs() {
    const filterVal = logFilter.value;
    let filteredLogs = localLogs;
    
    if (filterVal !== 'all') {
      filteredLogs = localLogs.filter(log => log.projectId === filterVal);
    }
    
    const totalLogs = filteredLogs.length;
    const totalPages = Math.ceil(totalLogs / pageSize) || 1;
    
    if (currentPage > totalPages) {
      currentPage = totalPages;
    }
    if (currentPage < 1) {
      currentPage = 1;
    }
    
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalLogs);
    const paginatedLogs = filteredLogs.slice(startIndex, endIndex);
    
    renderLogs(paginatedLogs);
    
    if (totalLogs === 0) {
      pageInfo.textContent = 'Showing 0-0 of 0 logs';
    } else {
      pageInfo.textContent = `Showing ${startIndex + 1}-${endIndex} of ${totalLogs} logs`;
    }
    
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages;
  }

  // Modal DOM elements
  const newProjectBtn = document.getElementById('newProjectBtn');
  const projectModal = document.getElementById('projectModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const createProjectForm = document.getElementById('createProjectForm');
  const modalProjectId = document.getElementById('modalProjectId');
  const modalProjectName = document.getElementById('modalProjectName');
  const modalTokenLimit = document.getElementById('modalTokenLimit');
  const modalProjectActive = document.getElementById('modalProjectActive');

  function openProjectModal() {
    createProjectForm.reset();
    modalTokenLimit.value = '500000';
    modalProjectActive.checked = true;
    projectModal.style.display = 'flex';
    modalProjectId.focus();
  }

  function closeProjectModal() {
    projectModal.style.display = 'none';
  }

  if (newProjectBtn) {
    newProjectBtn.addEventListener('click', openProjectModal);
  }
  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeProjectModal);
  }
  if (cancelModalBtn) {
    cancelModalBtn.addEventListener('click', closeProjectModal);
  }

  // Close modal when clicking on overlay background
  projectModal.addEventListener('click', (e) => {
    if (e.target === projectModal) {
      closeProjectModal();
    }
  });

  // Handle Create Project Form Submission
  createProjectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const projectId = modalProjectId.value.trim().toLowerCase();
    const name = modalProjectName.value.trim();
    const tokenLimit = parseInt(modalTokenLimit.value, 10) || 500000;
    const isActive = modalProjectActive.checked;

    if (!projectId || !name) {
      alert('Please fill out all required fields.');
      return;
    }

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, name, tokenLimit, isActive })
      });
      const data = await res.json();
      if (data.success) {
        closeProjectModal();
        alert(`Project "${name}" (${projectId}) created successfully!`);
        loadData();
      } else {
        alert('Failed to create project: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Failed to connect to server: ' + err.message);
    }
  });

  // Render Projects Grid
  function renderProjects(projects) {
    if (projects.length === 0) {
      projectsGrid.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-state-icon">🚀</div>
          <h3>No Projects Registered Yet</h3>
          <p>Create your first project to start tracking OpenAI token consumption and enforcing limits.</p>
          <button id="emptyCreateBtn" class="btn btn-primary">➕ Create First Project</button>
        </div>
      `;
      const emptyBtn = document.getElementById('emptyCreateBtn');
      if (emptyBtn) {
        emptyBtn.addEventListener('click', openProjectModal);
      }
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

  // Handle Log Filter Change
  logFilter.addEventListener('change', () => {
    currentPage = 1;
    renderFilteredAndPaginatedLogs();
  });

  // Handle Prev Page Action
  prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderFilteredAndPaginatedLogs();
    }
  });

  // Handle Next Page Action
  nextPageBtn.addEventListener('click', () => {
    const filterVal = logFilter.value;
    let filteredLogs = localLogs;
    if (filterVal !== 'all') {
      filteredLogs = localLogs.filter(log => log.projectId === filterVal);
    }
    const totalPages = Math.ceil(filteredLogs.length / pageSize) || 1;
    if (currentPage < totalPages) {
      currentPage++;
      renderFilteredAndPaginatedLogs();
    }
  });

  // Initial Load
  loadData();
});
