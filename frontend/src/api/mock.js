/**
 * Mock API Adapter for Secure Cloud Storage
 *
 * Provides a complete offline simulation of DynamoDB-backed user authentication,
 * Zero-Knowledge client-side encryption with recovery key rotation,
 * S3 presigned transfers, folder trees, multi-user sharing, and storage quota tracking.
 */

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
  hashPassword
} from '../crypto.js';

const STORAGE_KEY_PREFIX = 'scs_mock_';
const delay = (ms = 180) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: LocalStorage state persistence
function loadState(key, defaultVal) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + key);
    return raw ? JSON.parse(raw) : defaultVal;
  } catch {
    return defaultVal;
  }
}

function saveState(key, val) {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(val));
  } catch (err) {
    console.error('Failed to persist mock state:', err);
  }
}

// In-memory binary storage for uploaded encrypted files
const mockBlobStorage = new Map();

// Initial Seed Data
const initialUsers = [
  {
    id: 'user_001',
    email: 'alice@example.com',
    password: 'Password123!',
    passwordSalt: 'YWxpY2Vfc2FsdF8xMjM0',
    passwordHash: '',
    wrappedMfkByPassword: '',
    wrappedMfkByRecovery: '',
    recoveryKey: 'ALIC-E901-RECO-VERY-KEY9-DEMO',
    verified: true
  },
  {
    id: 'user_002',
    email: 'bob@example.com',
    password: 'Password123!',
    passwordSalt: 'Ym9iX3NhbHRfMTIzNDU2',
    passwordHash: '',
    wrappedMfkByPassword: '',
    wrappedMfkByRecovery: '',
    recoveryKey: 'BOB2-2026-RECO-VERY-KEY9-DEMO',
    verified: true
  }
];

const initialFolders = [
  { id: 'folder_doc', userId: 'user_001', name: 'Work Documents', parentFolderId: null, createdAt: new Date(Date.now() - 86400000 * 5).toISOString() },
  { id: 'folder_img', userId: 'user_001', name: 'Design Assets', parentFolderId: null, createdAt: new Date(Date.now() - 86400000 * 3).toISOString() }
];

const initialFiles = [
  {
    id: 'file_001',
    userId: 'user_001',
    name: 'AWS_Security_Whitepaper.txt',
    sizeBytes: 1024,
    contentType: 'text/plain',
    folderId: 'folder_doc',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    shares: ['bob@example.com']
  },
  {
    id: 'file_002',
    userId: 'user_001',
    name: 'Architecture_Blueprint.txt',
    sizeBytes: 2048,
    contentType: 'text/plain',
    folderId: 'folder_img',
    createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    shares: []
  },
  {
    id: 'file_003',
    userId: 'user_001',
    name: 'Storage_Cost_Optimization_2026.txt',
    sizeBytes: 850,
    contentType: 'text/plain',
    folderId: null,
    createdAt: new Date().toISOString(),
    shares: []
  }
];

let users = loadState('users', initialUsers);
let folders = loadState('folders', initialFolders);
let files = loadState('files', initialFiles);

// Active Session
let currentSession = loadState('session', null);

/**
 * Ensures user has valid Zero-Knowledge wrapped MFKs initialized.
 */
async function ensureUserMfk(user) {
  if (user.wrappedMfkByPassword && user.wrappedMfkByRecovery) {
    return;
  }
  const salt = user.passwordSalt || bytesToBase64(generateRandomBytes(16));
  user.passwordSalt = salt;

  if (!user.passwordHash) {
    user.passwordHash = await hashPassword(user.password || 'Password123!', salt);
  }

  const mfkKey = await generateMfk();
  const rawMfk = await exportMfk(mfkKey);

  const pwWrapKey = await deriveKeyFromPassword(user.password || 'Password123!', salt);
  user.wrappedMfkByPassword = await wrapKey(rawMfk, pwWrapKey);

  const recKey = user.recoveryKey || generateRecoveryKey();
  user.recoveryKey = recKey;
  const recWrapKey = await deriveKeyFromRecoveryKey(recKey, salt);
  user.wrappedMfkByRecovery = await wrapKey(rawMfk, recWrapKey);

  saveState('users', users);
}

export const mockApi = {
  // Auth
  async register(email, password, zkParams = null) {
    await delay(250);
    const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      throw new Error('An account with this email already exists.');
    }

    const salt = zkParams?.passwordSalt || bytesToBase64(generateRandomBytes(16));
    const pwHash = zkParams?.passwordHash || await hashPassword(password, salt);
    let wrappedPw = zkParams?.wrappedMfkPassword || '';
    let wrappedRec = zkParams?.wrappedMfkRecovery || '';
    let recoveryKey = zkParams?.recoveryKey || '';

    if (!wrappedPw || !wrappedRec) {
      const mfk = await generateMfk();
      const rawMfk = await exportMfk(mfk);
      const pwKey = await deriveKeyFromPassword(password, salt);
      wrappedPw = await wrapKey(rawMfk, pwKey);

      if (!recoveryKey) recoveryKey = generateRecoveryKey();
      const recKey = await deriveKeyFromRecoveryKey(recoveryKey, salt);
      wrappedRec = await wrapKey(rawMfk, recKey);
    }

    const newUser = {
      id: 'user_' + Math.random().toString(36).substring(2, 9),
      email,
      password,
      passwordSalt: salt,
      passwordHash: pwHash,
      wrappedMfkByPassword: wrappedPw,
      wrappedMfkByRecovery: wrappedRec,
      recoveryKey,
      verified: true
    };

    users.push(newUser);
    saveState('users', users);

    return {
      message: 'Account created successfully! You can now log in.',
      userId: newUser.id,
      email,
      recoveryKey
    };
  },

  async login(email, password) {
    await delay(220);
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      throw new Error('Incorrect email or password.');
    }

    await ensureUserMfk(user);

    // Verify password: check passwordHash or plain password match
    let isValid = false;
    if (user.password === password) {
      isValid = true;
    } else if (user.passwordHash) {
      const computedHash = await hashPassword(password, user.passwordSalt);
      isValid = (computedHash === user.passwordHash || password === user.passwordHash);
    }

    if (!isValid) {
      throw new Error('Incorrect email or password.');
    }

    currentSession = {
      userId: user.id,
      email: user.email,
      token: 'mock_jwt_' + user.id + '_' + Date.now(),
      passwordSalt: user.passwordSalt,
      wrappedMfkByPassword: user.wrappedMfkByPassword
    };
    saveState('session', currentSession);

    return currentSession;
  },

  async getRecoveryInfo(email) {
    await delay(200);
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      throw new Error('User not found.');
    }
    await ensureUserMfk(user);
    return {
      userId: user.id,
      passwordSalt: user.passwordSalt,
      wrappedMfkByRecovery: user.wrappedMfkByRecovery
    };
  },

  async resetPassword(email, resetParams) {
    await delay(250);
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      throw new Error('User not found.');
    }

    user.passwordHash = resetParams.newPasswordHash;
    user.passwordSalt = resetParams.newPasswordSalt;
    user.wrappedMfkByPassword = resetParams.newWrappedMfkPassword;
    user.wrappedMfkByRecovery = resetParams.newWrappedMfkRecovery;
    if (resetParams.newPassword) {
      user.password = resetParams.newPassword;
    }

    saveState('users', users);
    return {
      message: 'Password reset successful. You can now log in.',
      userId: user.id,
      email: user.email
    };
  },

  async logout() {
    await delay(100);
    currentSession = null;
    saveState('session', null);
    return { success: true };
  },

  getCurrentSession() {
    return currentSession;
  },

  saveCurrentSession(session) {
    currentSession = session;
    saveState('session', session);
  },

  // Quota
  async getQuota() {
    await delay(120);
    if (!currentSession) throw new Error('Unauthorized');
    const userFiles = files.filter(f => f.userId === currentSession.userId);
    const usedBytes = userFiles.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
    const quotaBytes = 5 * 1024 * 1024 * 1024; // 5 GB default

    return {
      userId: currentSession.userId,
      email: currentSession.email,
      quotaBytes,
      usedBytes,
      fileCount: userFiles.length,
      percentage: Math.min(100, Math.round((usedBytes / quotaBytes) * 100))
    };
  },

  // Folders & Files
  async getFiles(folderId = null) {
    await delay(150);
    if (!currentSession) throw new Error('Unauthorized');

    const normFolderId = folderId || null;
    const currentFolders = folders.filter(f => f.userId === currentSession.userId && f.parentFolderId === normFolderId);
    const currentFiles = files.filter(f => f.userId === currentSession.userId && f.folderId === normFolderId);

    // Build breadcrumb trail
    const breadcrumbs = [{ id: null, name: 'My Drive' }];
    if (normFolderId) {
      let curr = folders.find(f => f.id === normFolderId && f.userId === currentSession.userId);
      const trail = [];
      while (curr) {
        trail.unshift({ id: curr.id, name: curr.name });
        curr = curr.parentFolderId ? folders.find(f => f.id === curr.parentFolderId) : null;
      }
      breadcrumbs.push(...trail);
    }

    return {
      currentFolderId: normFolderId,
      breadcrumbs,
      folders: currentFolders,
      files: currentFiles
    };
  },

  async createFolder(name, parentFolderId = null) {
    await delay(160);
    if (!currentSession) throw new Error('Unauthorized');
    if (!name || !name.trim()) throw new Error('Folder name cannot be empty.');

    const newFolder = {
      id: 'folder_' + Math.random().toString(36).substring(2, 9),
      userId: currentSession.userId,
      name: name.trim(),
      parentFolderId: parentFolderId || null,
      createdAt: new Date().toISOString()
    };

    folders.push(newFolder);
    saveState('folders', folders);
    return newFolder;
  },

  async deleteFolder(folderId) {
    await delay(180);
    if (!currentSession) throw new Error('Unauthorized');

    const hasFiles = files.some(f => f.folderId === folderId && f.userId === currentSession.userId);
    const hasSubfolders = folders.some(f => f.parentFolderId === folderId && f.userId === currentSession.userId);

    if (hasFiles || hasSubfolders) {
      throw new Error('Folder is not empty. Please delete internal files and subfolders first.');
    }

    folders = folders.filter(f => !(f.id === folderId && f.userId === currentSession.userId));
    saveState('folders', folders);
    return { success: true };
  },

  // Upload workflow (Presign -> Direct PUT -> Confirm)
  async getUploadUrl(fileName, sizeBytes, contentType, folderId = null, originalContentType = '') {
    await delay(150);
    if (!currentSession) throw new Error('Unauthorized');

    const quota = await this.getQuota();
    if (quota.usedBytes + sizeBytes > quota.quotaBytes) {
      throw new Error(`Storage quota exceeded. Available: ${((quota.quotaBytes - quota.usedBytes) / 1024 / 1024).toFixed(1)} MB.`);
    }

    const fileId = 'file_' + Math.random().toString(36).substring(2, 9);
    const uploadId = 'up_' + Math.random().toString(36).substring(2, 9);

    return {
      uploadId,
      fileId,
      fileName,
      sizeBytes,
      contentType: contentType || 'application/octet-stream',
      originalContentType: originalContentType || 'application/octet-stream',
      folderId: folderId || null,
      presignedUrl: `mock://s3-private-bucket/objects/${currentSession.userId}/${fileId}/${encodeURIComponent(fileName)}`,
      expiresInSeconds: 300,
      headers: {
        'x-amz-server-side-encryption': 'AES256'
      }
    };
  },

  async uploadDirect(uploadTicket, encryptedBlob, onProgress) {
    const totalSteps = 8;
    for (let i = 1; i <= totalSteps; i++) {
      await delay(30);
      if (onProgress) {
        onProgress(Math.round((i / totalSteps) * 100));
      }
    }
    // Store encrypted blob in memory for subsequent downloads
    mockBlobStorage.set(uploadTicket.fileId, encryptedBlob);
    return { success: true };
  },

  async confirmUpload(uploadTicket, extra = {}) {
    await delay(140);
    if (!currentSession) throw new Error('Unauthorized');

    const newFile = {
      id: uploadTicket.fileId,
      userId: currentSession.userId,
      name: uploadTicket.fileName,
      sizeBytes: uploadTicket.sizeBytes,
      contentType: extra.originalContentType || uploadTicket.originalContentType || uploadTicket.contentType,
      folderId: uploadTicket.folderId,
      createdAt: new Date().toISOString(),
      shares: []
    };

    files.push(newFile);
    saveState('files', files);
    return newFile;
  },

  // Download workflow (Presign GET -> Decrypt)
  async getDownloadUrl(fileId) {
    await delay(150);
    if (!currentSession) throw new Error('Unauthorized');

    const file = files.find(f => f.id === fileId);
    if (!file) throw new Error('File not found.');

    const isOwner = file.userId === currentSession.userId;
    const isSharedViewer = file.shares && file.shares.includes(currentSession.email);

    if (!isOwner && !isSharedViewer) {
      throw new Error('Access denied: You do not have permission to view or download this file.');
    }

    let downloadBlob;
    if (mockBlobStorage.has(file.id)) {
      downloadBlob = mockBlobStorage.get(file.id);
    } else {
      // Create seed file encrypted content using active session MFK
      const plainText = `Secure Cloud Storage Encrypted File: ${file.name}\nSize: ${file.sizeBytes} bytes\nOwner: ${file.userId}\nDecrypted securely in client memory.`;
      const enc = new TextEncoder();
      const plainBytes = enc.encode(plainText);

      if (currentSession && currentSession.mfk) {
        const mfkKey = await importMfk(currentSession.mfk);
        const encBuffer = await encryptBinary(plainBytes.buffer, mfkKey);
        downloadBlob = new Blob([encBuffer], { type: 'application/octet-stream' });
      } else {
        downloadBlob = new Blob([plainBytes], { type: file.contentType || 'text/plain' });
      }
    }

    const downloadUrl = URL.createObjectURL(downloadBlob);

    return {
      fileId: file.id,
      fileName: file.name,
      contentType: file.contentType || 'application/octet-stream',
      downloadUrl,
      expiresInSeconds: 300
    };
  },

  async deleteFile(fileId) {
    await delay(160);
    if (!currentSession) throw new Error('Unauthorized');

    const file = files.find(f => f.id === fileId);
    if (!file) throw new Error('File not found.');
    if (file.userId !== currentSession.userId) {
      throw new Error('Access denied: Only the file owner can delete this file.');
    }

    files = files.filter(f => f.id !== fileId);
    mockBlobStorage.delete(fileId);
    saveState('files', files);
    return { success: true };
  },

  // Sharing
  async shareFile(fileId, recipientEmail) {
    await delay(180);
    if (!currentSession) throw new Error('Unauthorized');

    const file = files.find(f => f.id === fileId && f.userId === currentSession.userId);
    if (!file) throw new Error('File not found or access denied.');

    const email = recipientEmail.trim().toLowerCase();
    if (!email) throw new Error('Recipient email is required.');
    if (email === currentSession.email.toLowerCase()) {
      throw new Error('You cannot share a file with yourself.');
    }

    if (!file.shares) file.shares = [];
    if (!file.shares.includes(email)) {
      file.shares.push(email);
      saveState('files', files);
    }

    return {
      fileId: file.id,
      sharedWith: file.shares
    };
  },

  async revokeShare(fileId, recipientEmail) {
    await delay(150);
    if (!currentSession) throw new Error('Unauthorized');

    const file = files.find(f => f.id === fileId && f.userId === currentSession.userId);
    if (!file) throw new Error('File not found or access denied.');

    const email = recipientEmail.trim().toLowerCase();
    if (file.shares) {
      file.shares = file.shares.filter(e => e.toLowerCase() !== email);
      saveState('files', files);
    }

    return {
      fileId: file.id,
      sharedWith: file.shares || []
    };
  },

  async getSharedWithMe() {
    await delay(180);
    if (!currentSession) throw new Error('Unauthorized');

    const sharedFiles = files.filter(f => f.shares && f.shares.includes(currentSession.email));
    return {
      files: sharedFiles.map(f => {
        const ownerUser = users.find(u => u.id === f.userId);
        return {
          ...f,
          ownerEmail: ownerUser ? ownerUser.email : 'Unknown Owner'
        };
      })
    };
  }
};
