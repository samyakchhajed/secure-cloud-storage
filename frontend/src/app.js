/**
 * Secure Cloud Storage — Single Page Application (SPA)
 *
 * Core router, page views, and interactive state manager.
 * Zero external JS dependencies.
 * Zero-Knowledge Client-Side Encryption with Recovery Key.
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
  if (['py', 'js', 'ts', 'html', 'css', 'json', 'tf', 'txt'].includes(ext)) return '💻';
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
  quota: { usedBytes: 0, quotaBytes: 5 * 1024 * 1024 * 1024, percentage: 0 },
  activeModal: null, // null | 'upload' | 'create_folder' | 'share' | 'recovery_key' | 'security_info'
  selectedFileForShare: null,
  isUploading: false,
  uploadProgress: 0,
  recoveryModalData: null // { recoveryKey, email, isReset }
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
          <p class="auth-subtitle">Zero-Knowledge Encrypted Cloud File Storage on AWS</p>
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
      <div style="display:flex; justify-content:flex-end; margin-top:-6px; margin-bottom:8px;">
        <a href="#/forgot-password" class="auth-link-sm">Forgot password?</a>
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
      <div class="form-group">
        <label class="form-label" for="reg-confirm-password">Confirm Password</label>
        <input class="form-input" type="password" id="reg-confirm-password" placeholder="Re-enter password" minlength="8" required />
      </div>
      <button type="submit" class="btn-primary" id="register-submit-btn">
        Create Account & Generate Key →
      </button>
    </form>
    <div class="auth-footer">
      Already have an account? <a href="#/login">Sign in</a>
    </div>
  `);
}

function renderForgotPassword() {
  return renderAuthShell(`
    <form id="forgot-password-form" class="auth-form">
      <div class="form-group">
        <label class="form-label" for="reset-email">Email Address</label>
        <input class="form-input" type="email" id="reset-email" placeholder="alice@example.com" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="reset-recovery-key">24-Character Recovery Key</label>
        <input 
          class="form-input" 
          type="text" 
          id="reset-recovery-key" 
          placeholder="A3K9-X7M2-P1Q8-4V5B-Z9Y0-C2D1" 
          required 
          style="font-family:monospace; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;" 
        />
      </div>
      <div class="form-group">
        <label class="form-label" for="reset-new-password">New Password</label>
        <input class="form-input" type="password" id="reset-new-password" placeholder="At least 8 characters" minlength="8" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="reset-confirm-password">Confirm New Password</label>
        <input class="form-input" type="password" id="reset-confirm-password" placeholder="Re-enter new password" minlength="8" required />
      </div>
      <button type="submit" class="btn-primary" id="reset-submit-btn">
        Restore Access & Rotate Key →
      </button>
    </form>
    <div class="auth-footer">
      Remember your password? <a href="#/login">Sign in</a>
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
            <span>+</span> Upload Encrypted File
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
            <button class="btn-secondary" id="btn-open-security" title="Zero-Knowledge Encryption Status">
              🛡️ Encryption
            </button>
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

    <!-- Global Drag & Drop Overlay (Google Drive style) -->
    <div class="global-drag-overlay" id="global-drag-overlay">
      <div class="global-drag-card">
        <div class="global-drag-icon">☁️</div>
        <div class="global-drag-title">Drop files to instantly upload</div>
        <div class="global-drag-sub">Direct client-side AES-256-GCM encryption before transfer</div>
      </div>
    </div>
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
        <div class="section-title">Files (Zero-Knowledge Encrypted)</div>
        <div class="files-grid">
          ${filteredFiles.map(file => {
            const icon = getFileIcon(file.name, file.contentType);
            const isShared = file.shares && file.shares.length > 0;
            return `
              <div class="file-card" data-file-id="${file.id}">
                <div class="file-card-top">
                  <div class="file-type-badge">${icon}</div>
                  <div class="file-actions-menu">
                    <button class="icon-btn" data-action="download" data-file-id="${file.id}" title="Decrypt & Download">⬇️</button>
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
        <div class="section-title">Files (Zero-Knowledge Encrypted)</div>
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
                      <button class="icon-btn" data-action="download" data-file-id="${file.id}" title="Decrypt & Download">⬇️</button>
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
          Upload files or create subfolders using the buttons below or drag & drop files anywhere on the screen.
        </div>
        <div style="display:flex; gap:12px; margin-top:16px;">
          <button class="btn-primary" id="btn-empty-upload" style="width:auto; padding:8px 18px;">
            <span>+</span> Upload Files
          </button>
          <button class="btn-secondary" id="btn-empty-folder" style="width:auto; padding:8px 18px;">
            <span>📁</span> New Folder
          </button>
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
                    <button class="icon-btn" data-action="download" data-file-id="${file.id}" title="Decrypt & Download">⬇️</button>
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

  if (state.activeModal === 'recovery_key') {
    const data = state.recoveryModalData || {};
    const recoveryKey = data.recoveryKey || '';
    const isReset = Boolean(data.isReset);

    root.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-card recovery-modal-card">
          <div class="modal-header">
            <div class="modal-title">🔑 ${isReset ? 'New Recovery Key Generated' : 'Save Your Recovery Key'}</div>
          </div>
          <div class="modal-body">
            <p style="font-size:13px; color:var(--text-secondary); line-height:1.5;">
              ${isReset
                ? 'Your password has been updated and your master encryption key re-wrapped. <strong>Save this new recovery key immediately</strong> — your previous key is now obsolete.'
                : 'Secure Cloud Storage uses <strong>Zero-Knowledge Client-Side Encryption</strong>. Your files are encrypted with a Master File Key that only you hold. This 24-character recovery key is the <strong>only way to regain access</strong> if you forget your password.'}
            </p>

            <div class="recovery-key-display">
              <div class="recovery-key-text" id="recovery-key-text">${escapeHtml(recoveryKey)}</div>
              <div class="recovery-key-actions">
                <button type="button" class="btn-recovery-action" id="btn-copy-recovery-key">
                  📋 Copy Key
                </button>
                <button type="button" class="btn-recovery-action" id="btn-download-recovery-key">
                  💾 Download .TXT
                </button>
              </div>
            </div>

            <div class="security-warning-box">
              <span class="security-warning-icon">⚠️</span>
              <div>
                <strong>Keep this key secret and secure.</strong> Store it in a password manager or physical vault. We do not store this key and cannot reset it or recover your files for you.
              </div>
            </div>

            <label class="recovery-confirm-group" for="recovery-confirm-check">
              <input type="checkbox" id="recovery-confirm-check" />
              <span>I have safely copied or downloaded my recovery key. I understand that without it or my password, my files cannot be recovered.</span>
            </label>
          </div>
          <div class="modal-footer">
            <button class="btn-primary" id="btn-recovery-continue" disabled style="width:auto; padding:10px 24px;">
              Continue to Sign In →
            </button>
          </div>
        </div>
      </div>
    `;
    attachRecoveryKeyModalEvents();
  } else if (state.activeModal === 'security_info') {
    const session = getSession();
    const hasMfk = Boolean(session && session.mfk);

    root.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-card">
          <div class="modal-header">
            <div class="modal-title">🛡️ Zero-Knowledge Security Overview</div>
            <button class="modal-close-btn" id="modal-close">✕</button>
          </div>
          <div class="modal-body">
            <div class="security-info-grid">
              <div class="security-info-row">
                <span class="security-info-label">File Encryption</span>
                <span class="security-info-val">AES-256-GCM (Browser)</span>
              </div>
              <div class="security-info-row">
                <span class="security-info-label">Key Wrapping</span>
                <span class="security-info-val">PBKDF2-SHA256 (300k rounds)</span>
              </div>
              <div class="security-info-row">
                <span class="security-info-label">Auth Hashing</span>
                <span class="security-info-val">PBKDF2-SHA256 (260k rounds)</span>
              </div>
              <div class="security-info-row">
                <span class="security-info-label">Master Key Status</span>
                <span class="security-info-val">${hasMfk ? '✓ Active in Session' : 'Locked'}</span>
              </div>
              <div class="security-info-row">
                <span class="security-info-label">S3 Cloud Storage</span>
                <span class="security-info-val">Ciphertext Blobs Only</span>
              </div>
            </div>

            <div style="font-size:12px; color:var(--text-muted); line-height:1.5;">
              All encryption and decryption operations take place locally in your browser memory using the native Web Crypto API. Plaintext files and master encryption keys are never sent to the server.
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" id="modal-cancel">Close</button>
          </div>
        </div>
      </div>
    `;
    attachSecurityInfoModalEvents();
  } else if (state.activeModal === 'upload') {
    root.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-card">
          <div class="modal-header">
            <div class="modal-title">Upload Encrypted File</div>
            <button class="modal-close-btn" id="modal-close">✕</button>
          </div>
          <div class="modal-body">
            <div class="dropzone" id="dropzone">
              <div class="dropzone-icon">☁️</div>
              <div class="dropzone-text">Click to choose a file or drag & drop here</div>
              <div class="dropzone-subtext">Encrypted client-side with AES-256-GCM before transfer to S3</div>
              <input type="file" id="file-input-element" multiple style="display:none;" />
            </div>

            ${state.isUploading ? `
              <div class="upload-progress-container">
                <div class="upload-progress-header">
                  <span>Encrypting & uploading to S3...</span>
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

function attachRecoveryKeyModalEvents() {
  const copyBtn = document.getElementById('btn-copy-recovery-key');
  const downloadBtn = document.getElementById('btn-download-recovery-key');
  const check = document.getElementById('recovery-confirm-check');
  const continueBtn = document.getElementById('btn-recovery-continue');

  copyBtn?.addEventListener('click', async () => {
    const key = state.recoveryModalData?.recoveryKey || '';
    try {
      await navigator.clipboard.writeText(key);
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = '✓ Copied!';
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = '📋 Copy Key';
      }, 2500);
      showToast('Recovery key copied to clipboard!', 'success');
    } catch {
      showToast('Please select and copy the recovery key text manually.', 'info');
    }
  });

  downloadBtn?.addEventListener('click', () => {
    const data = state.recoveryModalData || {};
    const content = `SECURE CLOUD STORAGE — EMERGENCY RECOVERY KEY
=============================================================
Email: ${data.email || 'Your Account'}
Date: ${new Date().toUTCString()}
Recovery Key: ${data.recoveryKey || ''}
Security: Zero-Knowledge Client-Side AES-256-GCM

IMPORTANT INSTRUCTIONS:
1. Store this text file in an offline encrypted vault or password manager.
2. If you lose your password, this recovery key is the ONLY way to regain access to your files.
3. No one, including cloud storage administrators, can recover your files without this key.
=============================================================`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `secure-cloud-storage-recovery-key-${(data.email || 'account').replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Recovery key downloaded as text file.', 'success');
  });

  check?.addEventListener('change', (e) => {
    if (continueBtn) {
      continueBtn.disabled = !e.target.checked;
    }
  });

  continueBtn?.addEventListener('click', () => {
    state.activeModal = null;
    state.recoveryModalData = null;
    renderModal();
    showToast('Setup complete! You can now sign in.', 'success');
    window.location.hash = '#/login';
  });
}

function attachSecurityInfoModalEvents() {
  const closeBtn = document.getElementById('modal-close');
  const cancelBtn = document.getElementById('modal-cancel');
  const close = () => { state.activeModal = null; renderModal(); };
  closeBtn?.addEventListener('click', close);
  cancelBtn?.addEventListener('click', close);
}

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
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesUpload(e.dataTransfer.files);
    }
  });

  fileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesUpload(e.target.files);
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
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addBtn?.click();
    }
  });
}

async function handleFilesUpload(filesList) {
  if (!filesList || filesList.length === 0) return;
  const files = Array.from(filesList);

  state.activeModal = 'upload';
  state.isUploading = true;
  state.uploadProgress = 0;
  renderModal();

  let successCount = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      if (files.length > 1) {
        showToast(`Encrypting & uploading (${i + 1}/${files.length}): ${file.name}...`, 'info');
      }
      await api.uploadFile(file, state.currentFolderId, (progress) => {
        state.uploadProgress = Math.round(((i / files.length) * 100) + (progress / files.length));
        renderModal();
      });
      successCount++;
    } catch (err) {
      showToast(`Failed to upload "${file.name}": ${err.message}`, 'error');
    }
  }

  state.activeModal = null;
  state.isUploading = false;
  renderModal();
  if (successCount > 0) {
    showToast(`Successfully encrypted and uploaded ${successCount} file${successCount > 1 ? 's' : ''}.`, 'success');
  }
  await loadFilesView();
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

  document.getElementById('btn-open-security')?.addEventListener('click', () => {
    state.activeModal = 'security_info';
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
          showToast('Decrypting file with your Master Key...', 'info');
          await api.downloadFile(fileId);
          showToast('Decryption complete! File downloaded.', 'success');
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

  // Empty state action buttons
  document.getElementById('btn-empty-upload')?.addEventListener('click', () => {
    state.activeModal = 'upload';
    state.isUploading = false;
    renderModal();
  });

  document.getElementById('btn-empty-folder')?.addEventListener('click', () => {
    state.activeModal = 'create_folder';
    renderModal();
  });

  // Global Drag & drop anywhere over window
  const dragOverlay = document.getElementById('global-drag-overlay');
  let dragCount = 0;

  window.addEventListener('dragenter', (e) => {
    if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      dragCount++;
      dragOverlay?.classList.add('active');
    }
  });

  window.addEventListener('dragleave', () => {
    dragCount--;
    if (dragCount <= 0) {
      dragCount = 0;
      dragOverlay?.classList.remove('active');
    }
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCount = 0;
    dragOverlay?.classList.remove('active');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesUpload(e.dataTransfer.files);
    }
  });

  // Keyboard shortcut: Escape to dismiss modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.activeModal && !state.isUploading && state.activeModal !== 'recovery_key') {
      state.activeModal = null;
      renderModal();
    }
  });
}

function attachAuthEvents() {
  const loginForm = document.getElementById('login-form');
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email')?.value;
    const password = document.getElementById('login-password')?.value;
    const submitBtn = document.getElementById('login-submit-btn');

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = 'Unlocking Master Key...';
    }

    try {
      await api.login(email, password);
      showToast('Signed in & Master Key unlocked!', 'success');
      window.location.hash = '#/files';
    } catch (err) {
      showToast(err.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Sign In →';
      }
    }
  });

  const registerForm = document.getElementById('register-form');
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reg-email')?.value;
    const password = document.getElementById('reg-password')?.value;
    const confirmPassword = document.getElementById('reg-confirm-password')?.value;
    const submitBtn = document.getElementById('register-submit-btn');

    if (password !== confirmPassword) {
      showToast('Passwords do not match.', 'error');
      return;
    }
    if (password.length < 8) {
      showToast('Password must be at least 8 characters.', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = 'Generating Keys & Deriving Wrappers...';
    }

    try {
      const res = await api.register(email, password);
      state.recoveryModalData = {
        recoveryKey: res.recoveryKey,
        email: email,
        isReset: false
      };
      state.activeModal = 'recovery_key';
      renderModal();
    } catch (err) {
      showToast(err.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Create Account & Generate Key →';
      }
    }
  });

  const forgotForm = document.getElementById('forgot-password-form');
  forgotForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reset-email')?.value;
    const recoveryKey = document.getElementById('reset-recovery-key')?.value;
    const newPassword = document.getElementById('reset-new-password')?.value;
    const confirmPassword = document.getElementById('reset-confirm-password')?.value;
    const submitBtn = document.getElementById('reset-submit-btn');

    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match.', 'error');
      return;
    }
    if (newPassword.length < 8) {
      showToast('Password must be at least 8 characters.', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = 'Unwrapping & Re-encrypting Key...';
    }

    try {
      const res = await api.resetPassword(email, recoveryKey, newPassword);
      state.recoveryModalData = {
        recoveryKey: res.newRecoveryKey,
        email: email,
        isReset: true
      };
      state.activeModal = 'recovery_key';
      renderModal();
    } catch (err) {
      showToast(err.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Restore Access & Rotate Key →';
      }
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
  const isAuthRoute = ['#/login', '#/register', '#/forgot-password'].includes(route);
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
  } else if (route === '#/forgot-password') {
    app.innerHTML = renderForgotPassword();
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
