/**
 * Secure Cloud Storage — Single Page Application (SPA)
 *
 * Core router, page views, and interactive state manager.
 * Zero external JS dependencies.
 */

import { api, getSession } from './api/client.js';

// ==========================================================================
// Toast Notification Utility
// ==========================================================================

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const iconMap = {
    success: '✓',
    error: '✕',
    info: 'ℹ'
  };

  toast.innerHTML = `
    <span style="font-weight:700; font-size:14px;">${iconMap[type] || 'ℹ'}</span>
    <span style="flex:1;">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

// ==========================================================================
// Helpers
// ==========================================================================

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return isoStr;
  }
}

function getFileIcon(fileName, contentType = '') {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext) || contentType.startsWith('image/')) return '🖼️';
  if (['pdf'].includes(ext) || contentType.includes('pdf')) return '📄';
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return '📦';
  if (['csv', 'xlsx', 'xls'].includes(ext)) return '📊';
  if (['mp4', 'mov', 'avi', 'webm'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'ogg'].includes(ext)) return '🎵';
  if (['py', 'js', 'ts', 'html', 'css', 'json', 'tf'].includes(ext)) return '💻';
  return '📁';
}

// ==========================================================================
// Application State
// ==========================================================================

const state = {
  viewMode: 'grid', // 'grid' | 'table'
  searchQuery: '',
  currentFolderId: null,
  breadcrumbs: [],
  folders: [],
  files: [],
  sharedFiles: [],
  quota: { usedBytes: 0, quotaBytes: 1073741824, percentage: 0 },
  activeModal: null, // null | 'upload' | 'create_folder' | 'share'
  selectedFileForShare: null,
  isUploading: false,
  uploadProgress: 0
};

// ==========================================================================
// Page Renderers
// ==========================================================================

function renderAuthShell(contentHtml) {
  return `
    <div class="auth-container">
      <div class="auth-card">
        <div class="auth-header">
          <div class="auth-logo">☁️</div>
          <h1 class="auth-title">Secure Cloud Storage</h1>
          <p class="auth-subtitle">Encrypted, multi-user cloud file storage on AWS</p>
        </div>
        ${contentHtml}
      </div>
    </div>
  `;
}

function renderLogin() {
  return renderAuthShell(`
    <form id="login-form" class="auth-form">
      <div class="form-group">
        <label class="form-label" for="login-email">Email Address</label>
        <input class="form-input" type="email" id="login-email" placeholder="alice@example.com" value="alice@example.com" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="login-password">Password</label>
        <input class="form-input" type="password" id="login-password" placeholder="••••••••" value="Password123!" required />
      </div>
      <button type="submit" class="btn-primary" id="login-submit-btn">
        Sign In →
      </button>
    </form>
    <div class="auth-footer">
      Don't have an account? <a href="#/register">Create one</a>
    </div>
  `);
}

function renderRegister() {
  return renderAuthShell(`
    <form id="register-form" class="auth-form">
      <div class="form-group">
        <label class="form-label" for="reg-email">Email Address</label>
        <input class="form-input" type="email" id="reg-email" placeholder="user@example.com" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="reg-password">Password</label>
        <input class="form-input" type="password" id="reg-password" placeholder="At least 8 characters" minlength="8" required />
      </div>
      <button type="submit" class="btn-primary" id="register-submit-btn">
        Create Account & Send Code →
      </button>
    </form>
    <div class="auth-footer">
      Already have an account? <a href="#/login">Sign in</a>
    </div>
  `);
}

function renderVerify(email = '') {
  return renderAuthShell(`
    <form id="verify-form" class="auth-form">
      <div class="form-group">
        <label class="form-label" for="verify-email">Email Address</label>
        <input class="form-input" type="email" id="verify-email" value="${escapeHtml(email)}" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="verify-code">Verification Code</label>
        <input class="form-input" type="text" id="verify-code" placeholder="6-digit code (e.g. 123456)" required />
      </div>
      <button type="submit" class="btn-primary" id="verify-submit-btn">
        Verify Email & Activate →
      </button>
    </form>
    <div class="auth-footer">
      Back to <a href="#/login">Sign in</a>
    </div>
  `);
}

function renderAppShell(contentHtml, activeNav = 'files') {
  const session = getSession();
  const userInitial = session && session.email ? session.email[0].toUpperCase() : 'U';
  const userEmail = session ? session.email : 'User';

  const used = formatBytes(state.quota.usedBytes);
  const total = formatBytes(state.quota.quotaBytes);
  const percent = state.quota.percentage;

  let progressClass = '';
  if (percent >= 90) progressClass = 'danger';
  else if (percent >= 75) progressClass = 'warning';

  return `
    <div class="app-shell">
      <!-- Left Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-header">
          <div class="sidebar-logo-icon">☁️</div>
          <div class="sidebar-title">Secure Storage</div>
        </div>

        <div class="sidebar-actions">
          <button class="btn-upload-primary" id="btn-open-upload">
            <span>+</span> Upload New File
          </button>
          <button class="btn-secondary" style="width:100%; justify-content:center;" id="btn-open-new-folder">
            <span>📁</span> New Folder
          </button>
        </div>

        <nav class="sidebar-nav">
          <a href="#/files" class="nav-item ${activeNav === 'files' ? 'active' : ''}">
            <span class="nav-icon">📁</span>
            <span>My Files</span>
          </a>
          <a href="#/shared" class="nav-item ${activeNav === 'shared' ? 'active' : ''}">
            <span class="nav-icon">👥</span>
            <span>Shared with Me</span>
          </a>
        </nav>

        <div class="sidebar-footer">
          <div class="quota-card">
            <div class="quota-header">
              <span>Storage</span>
              <span>${percent}%</span>
            </div>
            <div class="quota-progress-track">
              <div class="quota-progress-fill ${progressClass}" style="width: ${percent}%;"></div>
            </div>
            <div class="quota-stats">
              ${used} of ${total} used
            </div>
          </div>
        </div>
      </aside>

      <!-- Main Workspace -->
      <main class="workspace">
        <!-- Top Header -->
        <header class="top-header">
          <div class="search-box-container">
            <span class="search-icon">🔍</span>
            <input 
              type="text" 
              class="search-input" 
              id="search-input" 
              placeholder="Search files and folders..." 
              value="${escapeHtml(state.searchQuery)}"
            />
          </div>

          <div class="header-right">
            ${api.isMock() ? '<span style="font-size:11px; background:#fef3c7; color:#92400e; padding:4px 8px; border-radius:4px; font-weight:600;">Mock Mode</span>' : ''}
            <div class="user-badge">
              <div class="user-avatar">${userInitial}</div>
              <span>${escapeHtml(userEmail)}</span>
            </div>
            <button class="btn-secondary" id="btn-logout" title="Sign Out">
              Sign Out
            </button>
          </div>
        </header>

        <!-- Main Dynamic Content -->
        <div class="content-area">
          ${contentHtml}
        </div>
      </main>
    </div>

    <!-- Modals Container -->
    <div id="modal-root"></div>
  `;
}

function renderFilesExplorer() {
  // Breadcrumbs
  const breadcrumbHtml = state.breadcrumbs.map((b, idx) => {
    const isLast = idx === state.breadcrumbs.length - 1;
    if (isLast) {
      return `<span class="breadcrumb-item active">${escapeHtml(b.name)}</span>`;
    }
    return `
      <span class="breadcrumb-item" data-folder-id="${b.id || ''}">${escapeHtml(b.name)}</span>
      <span class="breadcrumb-separator">/</span>
    `;
  }).join('');

  // Filter items by search query
  const query = state.searchQuery.toLowerCase().trim();
  const filteredFolders = state.folders.filter(f => !query || f.name.toLowerCase().includes(query));
  const filteredFiles = state.files.filter(f => !query || f.name.toLowerCase().includes(query));

  // Folders section
  let foldersSectionHtml = '';
  if (filteredFolders.length > 0) {
    foldersSectionHtml = `
      <div class="section-title">Folders</div>
      <div class="folders-grid">
        ${filteredFolders.map(folder => `
          <div class="folder-card" data-folder-id="${folder.id}">
            <div class="folder-info">
              <span class="folder-icon">📁</span>
              <span class="folder-name" title="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</span>
            </div>
            <button class="folder-delete-btn" data-delete-folder="${folder.id}" title="Delete folder">✕</button>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Files section
  let filesSectionHtml = '';
  if (filteredFiles.length > 0) {
    if (state.viewMode === 'grid') {
      filesSectionHtml = `
        <div class="section-title">Files</div>
        <div class="files-grid">
          ${filteredFiles.map(file => {
            const icon = getFileIcon(file.name, file.contentType);
            const isShared = file.shares && file.shares.length > 0;
            return `
              <div class="file-card" data-file-id="${file.id}">
                <div class="file-card-top">
                  <div class="file-type-badge">${icon}</div>
                  <div class="file-actions-menu">
                    <button class="icon-btn" data-action="download" data-file-id="${file.id}" title="Download">⬇️</button>
                    <button class="icon-btn" data-action="share" data-file-id="${file.id}" title="Share">👥</button>
                    <button class="icon-btn danger" data-action="delete" data-file-id="${file.id}" title="Delete">🗑️</button>
                  </div>
                </div>
                <div class="file-card-details">
                  <div class="file-card-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
                  <div class="file-card-meta">
                    <span>${formatBytes(file.sizeBytes)}</span>
                    ${isShared ? `<span class="shared-badge">Shared (${file.shares.length})</span>` : `<span>${formatDate(file.createdAt)}</span>`}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else {
      // Table view
      filesSectionHtml = `
        <div class="section-title">Files</div>
        <div class="files-table-container">
          <table class="files-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>Sharing</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filteredFiles.map(file => {
                const icon = getFileIcon(file.name, file.contentType);
                const isShared = file.shares && file.shares.length > 0;
                return `
                  <tr>
                    <td>
                      <div class="table-file-name">
                        <span>${icon}</span>
                        <span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                      </div>
                    </td>
                    <td>${formatBytes(file.sizeBytes)}</td>
                    <td>${formatDate(file.createdAt)}</td>
                    <td>
                      ${isShared ? `<span class="shared-badge">Shared with ${file.shares.length}</span>` : '<span style="color:var(--text-muted);">Private</span>'}
                    </td>
                    <td style="text-align:right;">
                      <button class="icon-btn" data-action="download" data-file-id="${file.id}" title="Download">⬇️</button>
                      <button class="icon-btn" data-action="share" data-file-id="${file.id}" title="Share">👥</button>
                      <button class="icon-btn danger" data-action="delete" data-file-id="${file.id}" title="Delete">🗑️</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  }

  // Empty state if neither folders nor files
  let emptyStateHtml = '';
  if (filteredFolders.length === 0 && filteredFiles.length === 0) {
    emptyStateHtml = `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <div class="empty-title">This folder is empty</div>
        <div class="empty-description">
          Upload files or create subfolders using the buttons on the left sidebar to get started.
        </div>
      </div>
    `;
  }

  return `
    <div class="explorer-toolbar">
      <div class="breadcrumbs">
        ${breadcrumbHtml}
      </div>

      <div class="explorer-actions">
        <div class="view-toggle">
          <button class="view-btn ${state.viewMode === 'grid' ? 'active' : ''}" id="toggle-view-grid" title="Grid View">
            ⊞ Grid
          </button>
          <button class="view-btn ${state.viewMode === 'table' ? 'active' : ''}" id="toggle-view-table" title="List View">
            ≡ List
          </button>
        </div>
      </div>
    </div>

    ${foldersSectionHtml}
    ${filesSectionHtml}
    ${emptyStateHtml}
  `;
}

function renderSharedWithMe() {
  const query = state.searchQuery.toLowerCase().trim();
  const filtered = state.sharedFiles.filter(f => !query || f.name.toLowerCase().includes(query) || (f.ownerEmail && f.ownerEmail.toLowerCase().includes(query)));

  let content = '';
  if (filtered.length === 0) {
    content = `
      <div class="empty-state">
        <div class="empty-icon">👥</div>
        <div class="empty-title">No files shared with you</div>
        <div class="empty-description">
          When other users share files with your email address, they will appear here.
        </div>
      </div>
    `;
  } else {
    content = `
      <div class="files-table-container">
        <table class="files-table">
          <thead>
            <tr>
              <th>File Name</th>
              <th>Owner</th>
              <th>Size</th>
              <th>Access</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(file => {
              const icon = getFileIcon(file.name, file.contentType);
              return `
                <tr>
                  <td>
                    <div class="table-file-name">
                      <span>${icon}</span>
                      <span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                    </div>
                  </td>
                  <td>${escapeHtml(file.ownerEmail || 'Unknown')}</td>
                  <td>${formatBytes(file.sizeBytes)}</td>
                  <td><span class="shared-badge">Viewer</span></td>
                  <td style="text-align:right;">
                    <button class="icon-btn" data-action="download" data-file-id="${file.id}" title="Download">⬇️</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  return `
    <div class="explorer-toolbar">
      <div class="breadcrumbs">
        <span class="breadcrumb-item active">Shared with Me</span>
      </div>
    </div>
    ${content}
  `;
}

// ==========================================================================
// Modals
// ==========================================================================

function renderModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;

  if (!state.activeModal) {
    root.innerHTML = '';
    return;
  }

  if (state.activeModal === 'upload') {
    root.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-card">
          <div class="modal-header">
            <div class="modal-title">Upload File to S3</div>
            <button class="modal-close-btn" id="modal-close">✕</button>
          </div>
          <div class="modal-body">
            <div class="dropzone" id="dropzone">
              <div class="dropzone-icon">☁️</div>
              <div class="dropzone-text">Click to choose a file or drag & drop here</div>
              <div class="dropzone-subtext">Direct S3 presigned upload with SSE-S3 AES-256 encryption</div>
              <input type="file" id="file-input-element" style="display:none;" />
            </div>

            ${state.isUploading ? `
              <div class="upload-progress-container">
                <div class="upload-progress-header">
                  <span>Uploading directly to S3...</span>
                  <span>${state.uploadProgress}%</span>
                </div>
                <div class="quota-progress-track">
                  <div class="quota-progress-fill" style="width:${state.uploadProgress}%;"></div>
                </div>
              </div>
            ` : ''}
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" id="modal-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;
    attachUploadModalEvents();
  } else if (state.activeModal === 'create_folder') {
    root.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-card">
          <div class="modal-header">
            <div class="modal-title">Create New Folder</div>
            <button class="modal-close-btn" id="modal-close">✕</button>
          </div>
          <div class="modal-body">
            <form id="create-folder-form">
              <div class="form-group">
                <label class="form-label" for="folder-name-input">Folder Name</label>
                <input class="form-input" type="text" id="folder-name-input" placeholder="e.g. Invoices" autofocus required />
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn-primary" id="btn-confirm-create-folder" style="width:auto;">Create Folder</button>
          </div>
        </div>
      </div>
    `;
    attachCreateFolderEvents();
  } else if (state.activeModal === 'share') {
    const file = state.selectedFileForShare;
    const shares = file && file.shares ? file.shares : [];

    root.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-card">
          <div class="modal-header">
            <div class="modal-title">Share "${escapeHtml(file ? file.name : '')}"</div>
            <button class="modal-close-btn" id="modal-close">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Share with recipient email</label>
              <div style="display:flex; gap:8px;">
                <input class="form-input" type="email" id="share-recipient-input" placeholder="bob@example.com" style="flex:1;" />
                <button class="btn-primary" id="btn-add-share" style="width:auto;">Add</button>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">People with access (${shares.length})</label>
              <div class="share-recipients-list">
                ${shares.length === 0 ? '<div style="font-size:12px; color:var(--text-muted); padding:4px;">No external users have access.</div>' : ''}
                ${shares.map(email => `
                  <div class="share-recipient-item">
                    <span class="share-recipient-email">${escapeHtml(email)}</span>
                    <button class="btn-danger-outline" data-revoke-share="${escapeHtml(email)}" style="padding:2px 8px; font-size:11px;">Revoke</button>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" id="modal-cancel">Done</button>
          </div>
        </div>
      </div>
    `;
    attachShareModalEvents();
  }
}

// ==========================================================================
// Event Listeners & Router
// ==========================================================================

function attachUploadModalEvents() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input-element');
  const closeBtn = document.getElementById('modal-close');
  const cancelBtn = document.getElementById('modal-cancel');

  closeBtn?.addEventListener('click', () => { state.activeModal = null; renderModal(); });
  cancelBtn?.addEventListener('click', () => { state.activeModal = null; renderModal(); });

  dropzone?.addEventListener('click', () => fileInput?.click());

  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone?.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  fileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  });
}

function attachCreateFolderEvents() {
  const closeBtn = document.getElementById('modal-close');
  const cancelBtn = document.getElementById('modal-cancel');
  const confirmBtn = document.getElementById('btn-confirm-create-folder');
  const form = document.getElementById('create-folder-form');
  const input = document.getElementById('folder-name-input');

  const close = () => { state.activeModal = null; renderModal(); };
  closeBtn?.addEventListener('click', close);
  cancelBtn?.addEventListener('click', close);

  const submit = async () => {
    const name = input?.value.trim();
    if (!name) return;
    try {
      await api.createFolder(name, state.currentFolderId);
      showToast(`Folder "${name}" created.`, 'success');
      state.activeModal = null;
      renderModal();
      await loadFilesView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  confirmBtn?.addEventListener('click', submit);
  form?.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
}

function attachShareModalEvents() {
  const closeBtn = document.getElementById('modal-close');
  const cancelBtn = document.getElementById('modal-cancel');
  const addBtn = document.getElementById('btn-add-share');
  const input = document.getElementById('share-recipient-input');

  const close = () => { state.activeModal = null; state.selectedFileForShare = null; renderModal(); };
  closeBtn?.addEventListener('click', close);
  cancelBtn?.addEventListener('click', close);

  addBtn?.addEventListener('click', async () => {
    const email = input?.value.trim();
    if (!email || !state.selectedFileForShare) return;
    try {
      const res = await api.shareFile(state.selectedFileForShare.id, email);
      state.selectedFileForShare.shares = res.sharedWith;
      showToast(`File shared with ${email}`, 'success');
      renderModal();
      await loadFilesView(false);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.querySelectorAll('[data-revoke-share]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = btn.getAttribute('data-revoke-share');
      if (!email || !state.selectedFileForShare) return;
      try {
        const res = await api.revokeShare(state.selectedFileForShare.id, email);
        state.selectedFileForShare.shares = res.sharedWith;
        showToast(`Revoked access for ${email}`, 'info');
        renderModal();
        await loadFilesView(false);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

async function handleFileUpload(file) {
  state.isUploading = true;
  state.uploadProgress = 0;
  renderModal();

  try {
    await api.uploadFile(file, state.currentFolderId, (progress) => {
      state.uploadProgress = progress;
      renderModal();
    });
    showToast(`"${file.name}" uploaded successfully.`, 'success');
    state.activeModal = null;
    state.isUploading = false;
    renderModal();
    await loadFilesView();
  } catch (err) {
    state.isUploading = false;
    renderModal();
    showToast(err.message, 'error');
  }
}

async function loadFilesView(fetchQuota = true) {
  try {
    const [fileData, quotaData] = await Promise.all([
      api.getFiles(state.currentFolderId),
      fetchQuota ? api.getQuota() : Promise.resolve(state.quota)
    ]);

    state.breadcrumbs = fileData.breadcrumbs || [];
    state.folders = fileData.folders || [];
    state.files = fileData.files || [];
    if (fetchQuota) state.quota = quotaData;

    renderCurrentRoute();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadSharedView() {
  try {
    const [sharedData, quotaData] = await Promise.all([
      api.getSharedWithMe(),
      api.getQuota()
    ]);
    state.sharedFiles = sharedData.files || [];
    state.quota = quotaData;
    renderCurrentRoute();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function attachAppShellEvents() {
  // Sidebar actions
  document.getElementById('btn-open-upload')?.addEventListener('click', () => {
    state.activeModal = 'upload';
    state.isUploading = false;
    renderModal();
  });

  document.getElementById('btn-open-new-folder')?.addEventListener('click', () => {
    state.activeModal = 'create_folder';
    renderModal();
  });

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await api.logout();
    window.location.hash = '#/login';
  });

  // Search input
  const searchInput = document.getElementById('search-input');
  searchInput?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderCurrentRoute();
    // Retain focus
    const newSearch = document.getElementById('search-input');
    if (newSearch) {
      newSearch.focus();
      newSearch.selectionStart = newSearch.selectionEnd = newSearch.value.length;
    }
  });

  // View toggle
  document.getElementById('toggle-view-grid')?.addEventListener('click', () => {
    state.viewMode = 'grid';
    renderCurrentRoute();
  });
  document.getElementById('toggle-view-table')?.addEventListener('click', () => {
    state.viewMode = 'table';
    renderCurrentRoute();
  });

  // Breadcrumbs navigation
  document.querySelectorAll('[data-folder-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      const folderId = el.getAttribute('data-folder-id') || null;
      if (el.classList.contains('folder-delete-btn')) return;
      state.currentFolderId = folderId;
      loadFilesView();
    });
  });

  // Folder delete
  document.querySelectorAll('[data-delete-folder]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const folderId = btn.getAttribute('data-delete-folder');
      if (confirm('Are you sure you want to delete this empty folder?')) {
        try {
          await api.deleteFolder(folderId);
          showToast('Folder deleted.', 'info');
          await loadFilesView();
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    });
  });

  // File actions (Download, Share, Delete)
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      const fileId = btn.getAttribute('data-file-id');

      if (action === 'download') {
        try {
          showToast('Preparing download...', 'info');
          await api.downloadFile(fileId);
        } catch (err) {
          showToast(err.message, 'error');
        }
      } else if (action === 'delete') {
        if (confirm('Are you sure you want to delete this file?')) {
          try {
            await api.deleteFile(fileId);
            showToast('File deleted.', 'info');
            await loadFilesView();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      } else if (action === 'share') {
        const file = state.files.find(f => f.id === fileId);
        if (file) {
          state.selectedFileForShare = file;
          state.activeModal = 'share';
          renderModal();
        }
      }
    });
  });
}

function attachAuthEvents() {
  const loginForm = document.getElementById('login-form');
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email')?.value;
    const password = document.getElementById('login-password')?.value;
    try {
      await api.login(email, password);
      showToast('Signed in successfully.', 'success');
      window.location.hash = '#/files';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  const registerForm = document.getElementById('register-form');
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reg-email')?.value;
    const password = document.getElementById('reg-password')?.value;
    try {
      const res = await api.register(email, password);
      showToast(res.message || 'Verification code sent.', 'info');
      window.location.hash = `#/verify?email=${encodeURIComponent(email)}`;
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  const verifyForm = document.getElementById('verify-form');
  verifyForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('verify-email')?.value;
    const code = document.getElementById('verify-code')?.value;
    try {
      await api.verifyOtp(email, code);
      showToast('Email verified! You can now log in.', 'success');
      window.location.hash = '#/login';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ==========================================================================
// Main Router
// ==========================================================================

function renderCurrentRoute() {
  const app = document.getElementById('app');
  if (!app) return;

  const rawHash = window.location.hash || '#/files';
  const [route, queryString] = rawHash.split('?');
  const params = new URLSearchParams(queryString || '');
  const session = getSession();

  // Auth Guards
  const isAuthRoute = ['#/login', '#/register', '#/verify'].includes(route);
  if (!session && !isAuthRoute) {
    window.location.hash = '#/login';
    return;
  }
  if (session && isAuthRoute) {
    window.location.hash = '#/files';
    return;
  }

  if (route === '#/login') {
    app.innerHTML = renderLogin();
    attachAuthEvents();
  } else if (route === '#/register') {
    app.innerHTML = renderRegister();
    attachAuthEvents();
  } else if (route === '#/verify') {
    const email = params.get('email') || '';
    app.innerHTML = renderVerify(email);
    attachAuthEvents();
  } else if (route === '#/shared') {
    app.innerHTML = renderAppShell(renderSharedWithMe(), 'shared');
    attachAppShellEvents();
  } else {
    // Default: #/files
    app.innerHTML = renderAppShell(renderFilesExplorer(), 'files');
    attachAppShellEvents();
  }
}

// Router Initializer
window.addEventListener('hashchange', () => {
  const [route] = (window.location.hash || '').split('?');
  if (route === '#/files') {
    loadFilesView();
  } else if (route === '#/shared') {
    loadSharedView();
  } else {
    renderCurrentRoute();
  }
});

window.addEventListener('DOMContentLoaded', () => {
  const session = getSession();
  if (session) {
    loadFilesView();
  } else {
    renderCurrentRoute();
  }
});
