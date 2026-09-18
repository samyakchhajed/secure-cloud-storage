/**
 * Mock API Adapter for Secure Cloud Storage
 *
 * Provides a complete offline simulation of Cognito authentication,
 * DynamoDB single-table metadata, S3 presigned transfers, folder trees,
 * multi-user sharing, and storage quota tracking with realistic delays.
 */

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

// Initial Seed Data
const initialUsers = [
  { id: 'user_001', email: 'alice@example.com', password: 'Password123!', verified: true },
  { id: 'user_002', email: 'bob@example.com', password: 'Password123!', verified: true }
];

const initialFolders = [
  { id: 'folder_doc', userId: 'user_001', name: 'Work Documents', parentFolderId: null, createdAt: new Date(Date.now() - 86400000 * 5).toISOString() },
  { id: 'folder_img', userId: 'user_001', name: 'Design Assets', parentFolderId: null, createdAt: new Date(Date.now() - 86400000 * 3).toISOString() }
];

const initialFiles = [
  {
    id: 'file_001',
    userId: 'user_001',
    name: 'AWS_Security_Whitepaper.pdf',
    sizeBytes: 1420500,
    contentType: 'application/pdf',
    folderId: 'folder_doc',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    shares: ['bob@example.com']
  },
  {
    id: 'file_002',
    userId: 'user_001',
    name: 'Architecture_Blueprint.png',
    sizeBytes: 2890400,
    contentType: 'image/png',
    folderId: 'folder_img',
    createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    shares: []
  },
  {
    id: 'file_003',
    userId: 'user_001',
    name: 'Storage_Cost_Optimization_2026.xlsx',
    sizeBytes: 854000,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    folderId: null,
    createdAt: new Date().toISOString(),
    shares: []
  }
];

let users = loadState('users', initialUsers);
let folders = loadState('folders', initialFolders);
let files = loadState('files', initialFiles);
let pendingSignups = loadState('pending_signups', {});

// Active Session
let currentSession = loadState('session', {
  userId: 'user_001',
  email: 'alice@example.com',
  token: 'mock_jwt_token_alice_001'
});

export const mockApi = {
  // Auth
  async register(email, password) {
    await delay(250);
    const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existing && existing.verified) {
      throw new Error('An account with this email already exists.');
    }

    const otp = '123456'; // Standard mock OTP
    pendingSignups[email.toLowerCase()] = { email, password, otp, createdAt: Date.now() };
    saveState('pending_signups', pendingSignups);

    return {
      message: 'Signup initiated. A 6-digit verification code has been sent (Mock OTP: 123456).',
      email
    };
  },

  async verifyOtp(email, code) {
    await delay(200);
    const pending = pendingSignups[email.toLowerCase()];
    if (!pending || pending.otp !== code.trim()) {
      throw new Error('Invalid or expired verification code. Use 123456 for mock.');
    }

    const newUser = {
      id: 'user_' + Math.random().toString(36).substring(2, 9),
      email: pending.email,
      password: pending.password,
      verified: true
    };

    users.push(newUser);
    delete pendingSignups[email.toLowerCase()];
    saveState('users', users);
    saveState('pending_signups', pendingSignups);

    return { verified: true, message: 'Email verified successfully. You can now log in.' };
  },

  async login(email, password) {
    await delay(220);
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
    if (!user) {
      throw new Error('Invalid email or password.');
    }

    currentSession = {
      userId: user.id,
      email: user.email,
      token: 'mock_jwt_' + user.id + '_' + Date.now()
    };
    saveState('session', currentSession);

    return currentSession;
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

  // Quota
  async getQuota() {
    await delay(120);
    if (!currentSession) throw new Error('Unauthorized');
    const userFiles = files.filter(f => f.userId === currentSession.userId);
    const usedBytes = userFiles.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
    const quotaBytes = 1073741824; // 1 GB default

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

    // Check if folder has child folders or files
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
  async getUploadUrl(fileName, sizeBytes, contentType, folderId = null) {
    await delay(150);
    if (!currentSession) throw new Error('Unauthorized');

    // Quota validation
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
      folderId: folderId || null,
      presignedUrl: `mock://s3-private-bucket/objects/${currentSession.userId}/${fileId}/${encodeURIComponent(fileName)}`,
      expiresInSeconds: 300,
      headers: {
        'x-amz-server-side-encryption': 'AES256'
      }
    };
  },

  async uploadDirect(uploadTicket, fileBlob, onProgress) {
    // Simulate real upload chunks with progress updates
    const totalSteps = 10;
    for (let i = 1; i <= totalSteps; i++) {
      await delay(40);
      if (onProgress) {
        onProgress(Math.round((i / totalSteps) * 100));
      }
    }
    return { success: true };
  },

  async confirmUpload(uploadTicket) {
    await delay(140);
    if (!currentSession) throw new Error('Unauthorized');

    const newFile = {
      id: uploadTicket.fileId,
      userId: currentSession.userId,
      name: uploadTicket.fileName,
      sizeBytes: uploadTicket.sizeBytes,
      contentType: uploadTicket.contentType,
      folderId: uploadTicket.folderId,
      createdAt: new Date().toISOString(),
      shares: []
    };

    files.push(newFile);
    saveState('files', files);
    return newFile;
  },

  // Download workflow (Presign GET)
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

    // Generate mock downloadable data blob
    const mockContent = `Secure Cloud Storage File: ${file.name}\nSize: ${file.sizeBytes} bytes\nOwner ID: ${file.userId}\nDownloaded At: ${new Date().toISOString()}`;
    const blob = new Blob([mockContent], { type: file.contentType || 'text/plain' });
    const downloadUrl = URL.createObjectURL(blob);

    return {
      fileId: file.id,
      fileName: file.name,
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
