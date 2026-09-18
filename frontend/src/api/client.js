/**
 * Secure Cloud Storage — API Client
 *
 * Pluggable fetch wrapper that delegates to:
 * 1. Live AWS API Gateway HTTP API if `window.API_BASE_URL` is set.
 * 2. Local in-memory mock engine (`mock.js`) if `window.API_BASE_URL` is empty.
 */

import { mockApi } from './mock.js';

const SESSION_STORAGE_KEY = 'scs_auth_session';

export function getSession() {
  const isMock = !window.API_BASE_URL || window.API_BASE_URL.trim() === '';
  if (isMock) {
    return mockApi.getCurrentSession();
  }
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  const isMock = !window.API_BASE_URL || window.API_BASE_URL.trim() === '';
  if (isMock) return;
  if (session) {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } else {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

async function request(endpoint, options = {}) {
  const baseUrl = (window.API_BASE_URL || '').replace(/\/+$/, '');
  const url = `${baseUrl}${endpoint}`;

  const session = getSession();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (session && session.token) {
    headers['Authorization'] = `Bearer ${session.token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `Request failed with status ${response.status}`);
  }

  return data;
}

export const api = {
  isMock() {
    return !window.API_BASE_URL || window.API_BASE_URL.trim() === '';
  },

  // Authentication
  async register(email, password) {
    if (this.isMock()) return mockApi.register(email, password);
    return request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  },

  async verifyOtp(email, code) {
    if (this.isMock()) return mockApi.verifyOtp(email, code);
    return request('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code })
    });
  },

  async login(email, password) {
    if (this.isMock()) return mockApi.login(email, password);
    const result = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    saveSession(result);
    return result;
  },

  async logout() {
    if (this.isMock()) return mockApi.logout();
    saveSession(null);
    return { success: true };
  },

  // Quota
  async getQuota() {
    if (this.isMock()) return mockApi.getQuota();
    return request('/api/user/quota');
  },

  // Files & Folders
  async getFiles(folderId = null) {
    if (this.isMock()) return mockApi.getFiles(folderId);
    const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
    return request(`/api/files${query}`);
  },

  async createFolder(name, parentFolderId = null) {
    if (this.isMock()) return mockApi.createFolder(name, parentFolderId);
    return request('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parentFolderId })
    });
  },

  async deleteFolder(folderId) {
    if (this.isMock()) return mockApi.deleteFolder(folderId);
    return request(`/api/folders/${encodeURIComponent(folderId)}`, {
      method: 'DELETE'
    });
  },

  // Presigned S3 Upload Workflow
  async uploadFile(file, folderId = null, onProgress = null) {
    if (this.isMock()) {
      // 1. Get mock upload ticket
      const ticket = await mockApi.getUploadUrl(file.name, file.size, file.type, folderId);
      // 2. Direct upload simulation
      await mockApi.uploadDirect(ticket, file, onProgress);
      // 3. Confirm upload
      return mockApi.confirmUpload(ticket);
    }

    // Live AWS S3 Workflow:
    // Step 1: Request presigned PUT URL from Lambda
    const ticket = await request('/api/files/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name,
        sizeBytes: file.size,
        contentType: file.type || 'application/octet-stream',
        folderId: folderId || null
      })
    });

    // Step 2: Direct-to-S3 HTTP PUT with SSE-S3 header
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', ticket.presignedUrl, true);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('x-amz-server-side-encryption', 'AES256');

      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            onProgress(percent);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else {
          reject(new Error(`S3 upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during direct S3 transfer.'));
      xhr.send(file);
    });

    // Step 3: Confirm upload in DynamoDB and update quota
    return request('/api/files/confirm', {
      method: 'POST',
      body: JSON.stringify({
        fileId: ticket.fileId,
        fileName: file.name,
        sizeBytes: file.size,
        contentType: file.type || 'application/octet-stream',
        folderId: folderId || null
      })
    });
  },

  // Presigned S3 Download Workflow
  async downloadFile(fileId) {
    if (this.isMock()) {
      const { downloadUrl, fileName } = await mockApi.getDownloadUrl(fileId);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return { success: true };
    }

    const { downloadUrl, fileName } = await request(`/api/files/${encodeURIComponent(fileId)}/download-url`);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return { success: true };
  },

  async deleteFile(fileId) {
    if (this.isMock()) return mockApi.deleteFile(fileId);
    return request(`/api/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE'
    });
  },

  // Sharing
  async shareFile(fileId, recipientEmail) {
    if (this.isMock()) return mockApi.shareFile(fileId, recipientEmail);
    return request(`/api/files/${encodeURIComponent(fileId)}/share`, {
      method: 'POST',
      body: JSON.stringify({ recipientEmail })
    });
  },

  async revokeShare(fileId, recipientEmail) {
    if (this.isMock()) return mockApi.revokeShare(fileId, recipientEmail);
    return request(`/api/files/${encodeURIComponent(fileId)}/share/${encodeURIComponent(recipientEmail)}`, {
      method: 'DELETE'
    });
  },

  async getSharedWithMe() {
    if (this.isMock()) return mockApi.getSharedWithMe();
    return request('/api/files/shared-with-me');
  }
};
