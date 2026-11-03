/**
 * Secure Cloud Storage — API Client
 *
 * Pluggable fetch wrapper that delegates to:
 * 1. Live AWS API Gateway HTTP API if `window.API_BASE_URL` is set.
 * 2. Local in-memory mock engine (`mock.js`) if `window.API_BASE_URL` is empty.
 *
 * Includes Zero-Knowledge client-side AES-256-GCM encryption/decryption
 * and recovery-key powered key management.
 */

import { mockApi } from './mock.js';
import {
  generateRandomBytes,
  bytesToBase64,
  generateRecoveryKey,
  generateMfk,
  exportMfk,
  importMfk,
  deriveKeyFromPassword,
  deriveKeyFromRecoveryKey,
  wrapKey,
  unwrapKey,
  encryptBinary,
  decryptBinary,
  hashPassword,
  assertWebCryptoAvailable
} from '../crypto.js';

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
  if (isMock) {
    mockApi.saveCurrentSession(session);
    return;
  }
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

  // Authentication & Zero-Knowledge Registration
  async register(email, password) {
    assertWebCryptoAvailable();

    // 1. Generate unique 16-byte salt for user password & recovery key derivations
    const salt = bytesToBase64(generateRandomBytes(16));

    // 2. Hash password for server-side credential verification
    const passwordHash = await hashPassword(password, salt);

    // 3. Generate 256-bit AES-GCM Master File Key (MFK)
    const mfkKey = await generateMfk();
    const rawMfkBase64 = await exportMfk(mfkKey);

    // 4. Derive wrapping key from user password and wrap MFK
    const pwWrapKey = await deriveKeyFromPassword(password, salt);
    const wrappedMfkPassword = await wrapKey(rawMfkBase64, pwWrapKey);

    // 5. Generate human-readable 24-char recovery key
    const recoveryKey = generateRecoveryKey();

    // 6. Derive wrapping key from recovery key and wrap MFK
    const recWrapKey = await deriveKeyFromRecoveryKey(recoveryKey, salt);
    const wrappedMfkRecovery = await wrapKey(rawMfkBase64, recWrapKey);

    if (this.isMock()) {
      const res = await mockApi.register(email, password, {
        passwordHash,
        passwordSalt: salt,
        wrappedMfkPassword,
        wrappedMfkRecovery,
        recoveryKey
      });
      return { ...res, recoveryKey };
    }

    const res = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        passwordHash,
        passwordSalt: salt,
        wrappedMfkPassword,
        wrappedMfkRecovery
      })
    });

    if (!recoveryKey) {
      throw new Error('Registration completed without generating a recovery key. Please try again.');
    }

    return { ...res, recoveryKey };
  },

  async login(email, password) {
    assertWebCryptoAvailable();

    let result;
    if (this.isMock()) {
      result = await mockApi.login(email, password);
    } else {
      result = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
    }

    // Zero-Knowledge MFK Decryption
    if (result.wrappedMfkByPassword && result.passwordSalt) {
      try {
        const pwWrapKey = await deriveKeyFromPassword(password, result.passwordSalt);
        const rawMfkBase64 = await unwrapKey(result.wrappedMfkByPassword, pwWrapKey);
        result.mfk = rawMfkBase64;
      } catch (err) {
        console.error('Failed to unwrap Master File Key during login:', err);
        throw new Error('Failed to unwrap your encryption key. Please verify your credentials.');
      }
    }

    saveSession(result);
    return result;
  },

  async logout() {
    if (this.isMock()) return mockApi.logout();
    saveSession(null);
    return { success: true };
  },

  // Password Recovery using Recovery Key
  async getRecoveryInfo(email) {
    if (this.isMock()) return mockApi.getRecoveryInfo(email);
    return request('/api/auth/recovery-info', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  },

  async resetPassword(email, recoveryKey, newPassword) {
    assertWebCryptoAvailable();

    // 1. Fetch user's recovery info (salt and MFK wrapped by recovery key)
    const recInfo = await this.getRecoveryInfo(email);

    // 2. Derive wrapping key from recovery key and unwrap MFK
    const recWrapKey = await deriveKeyFromRecoveryKey(recoveryKey, recInfo.passwordSalt);
    const rawMfkBase64 = await unwrapKey(recInfo.wrappedMfkByRecovery, recWrapKey);

    // 3. Generate fresh recovery key & fresh salt
    const newRecoveryKey = generateRecoveryKey();
    const newSalt = bytesToBase64(generateRandomBytes(16));

    // 4. Derive new wrapping keys and re-wrap MFK
    const newPwWrapKey = await deriveKeyFromPassword(newPassword, newSalt);
    const newWrappedMfkPassword = await wrapKey(rawMfkBase64, newPwWrapKey);

    const newRecWrapKey = await deriveKeyFromRecoveryKey(newRecoveryKey, newSalt);
    const newWrappedMfkRecovery = await wrapKey(rawMfkBase64, newRecWrapKey);

    // 5. Compute new password hash
    const newPasswordHash = await hashPassword(newPassword, newSalt);

    if (this.isMock()) {
      await mockApi.resetPassword(email, {
        newPasswordHash,
        newPasswordSalt: newSalt,
        newWrappedMfkPassword,
        newWrappedMfkRecovery,
        newPassword
      });
      return { newRecoveryKey };
    }

    await request('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        email,
        newPasswordHash,
        newPasswordSalt: newSalt,
        newWrappedMfkPassword,
        newWrappedMfkRecovery
      })
    });

    return { newRecoveryKey };
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

  // Presigned S3 Upload Workflow with Client-Side Zero-Knowledge Encryption
  async uploadFile(file, folderId = null, onProgress = null) {
    const session = getSession();
    if (!session || !session.mfk) {
      throw new Error('Encryption key not found in active session. Please sign in again.');
    }

    // 1. Encrypt file binary client-side using MFK
    const rawBuffer = await file.arrayBuffer();
    const mfkKey = await importMfk(session.mfk);
    const encryptedBuffer = await encryptBinary(rawBuffer, mfkKey);
    const encryptedBlob = new Blob([encryptedBuffer], { type: 'application/octet-stream' });

    if (this.isMock()) {
      // 1. Get mock upload ticket
      const ticket = await mockApi.getUploadUrl(file.name, encryptedBlob.size, 'application/octet-stream', folderId, file.type);
      // 2. Direct upload simulation with encrypted blob
      await mockApi.uploadDirect(ticket, encryptedBlob, onProgress);
      // 3. Confirm upload
      return mockApi.confirmUpload(ticket, { originalContentType: file.type || 'application/octet-stream' });
    }

    // Live AWS S3 Workflow:
    // Step 1: Request presigned PUT URL from Lambda for encrypted blob
    const ticket = await request('/api/files/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name,
        sizeBytes: encryptedBlob.size,
        contentType: 'application/octet-stream',
        folderId: folderId || null
      })
    });

    // Step 2: Direct-to-S3 HTTP PUT with SSE-S3 header
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', ticket.presignedUrl, true);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
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
          reject(new Error(`S3 upload failed with status ${xhr.status}: ${xhr.responseText || 'No response body.'}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during direct S3 transfer. Check the S3 bucket region and CORS configuration.'));
      xhr.send(encryptedBlob);
    });

    // Step 3: Confirm upload in DynamoDB with original content-type
    return request('/api/files/confirm', {
      method: 'POST',
      body: JSON.stringify({
        fileId: ticket.fileId,
        fileName: file.name,
        sizeBytes: encryptedBlob.size,
        contentType: file.type || 'application/octet-stream',
        folderId: folderId || null
      })
    });
  },

  // Presigned S3 Download Workflow with Client-Side Zero-Knowledge Decryption
  async downloadFile(fileId) {
    const session = getSession();
    if (!session || !session.mfk) {
      throw new Error('Encryption key not found in active session. Please sign in again.');
    }

    let downloadUrl;
    let fileName;
    let contentType;

    if (this.isMock()) {
      const meta = await mockApi.getDownloadUrl(fileId);
      downloadUrl = meta.downloadUrl;
      fileName = meta.fileName;
      contentType = meta.contentType;
    } else {
      const meta = await request(`/api/files/${encodeURIComponent(fileId)}/download-url`);
      downloadUrl = meta.downloadUrl;
      fileName = meta.fileName;
      contentType = meta.contentType;
    }

    // Download encrypted payload
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch file data: status ${response.status}`);
    }
    const encryptedArrayBuffer = await response.arrayBuffer();

    // Decrypt in client memory
    const mfkKey = await importMfk(session.mfk);
    const decryptedBuffer = await decryptBinary(encryptedArrayBuffer, mfkKey);

    // Trigger browser download of decrypted original file
    const blob = new Blob([decryptedBuffer], { type: contentType || 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

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
