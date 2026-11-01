/**
 * Secure Cloud Storage — Cryptographic Utilities
 * Zero-Knowledge Client-Side Encryption with Recovery Key.
 *
 * Implemented using native window.crypto.subtle (zero external JS dependencies).
 */

export function assertWebCryptoAvailable() {
  if (!window.isSecureContext || !window.crypto?.subtle) {
    throw new Error('Secure browser encryption requires an HTTPS connection. Open the HTTPS deployment URL.');
  }
}

/**
 * Generates cryptographically secure random bytes.
 * @param {number} length
 * @returns {Uint8Array}
 */
export function generateRandomBytes(length) {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Converts a Uint8Array to a Base64 string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Converts a Base64 string to a Uint8Array.
 * @param {string} str
 * @returns {Uint8Array}
 */
export function base64ToBytes(str) {
  const binary = window.atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates a 24-character alphanumeric string formatted with dashes (e.g. A3K9-X7M2-P1Q8-4V5B-Z9Y0-C2D1).
 * Uses an unambiguous uppercase alphanumeric character set.
 * @returns {string}
 */
export function generateRecoveryKey() {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = generateRandomBytes(24);
  let key = '';
  for (let i = 0; i < 24; i++) {
    key += charset[bytes[i] % charset.length];
    if ((i + 1) % 4 === 0 && i !== 23) {
      key += '-';
    }
  }
  return key;
}

/**
 * Generates a 256-bit AES-GCM Master File Key (MFK).
 * @returns {Promise<CryptoKey>}
 */
export async function generateMfk() {
  return window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256
    },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Exports key to raw 32 bytes (base64 string).
 * @param {CryptoKey} cryptoKey
 * @returns {Promise<string>}
 */
export async function exportMfk(cryptoKey) {
  const rawBuffer = await window.crypto.subtle.exportKey('raw', cryptoKey);
  return bytesToBase64(new Uint8Array(rawBuffer));
}

/**
 * Imports raw 32 bytes (base64 string) back into an AES-GCM CryptoKey.
 * @param {string} rawBase64
 * @returns {Promise<CryptoKey>}
 */
export async function importMfk(rawBase64) {
  const rawBytes = base64ToBytes(rawBase64);
  return window.crypto.subtle.importKey(
    'raw',
    rawBytes,
    {
      name: 'AES-GCM',
      length: 256
    },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Normalizes salt input to Uint8Array bytes.
 * If string, uses UTF-8 text encoding to guarantee compatibility with backend PBKDF2.
 * @param {string|Uint8Array} salt
 * @returns {Uint8Array}
 */
function normalizeSalt(salt) {
  if (salt instanceof Uint8Array) {
    return salt;
  }
  return new TextEncoder().encode(String(salt));
}

/**
 * Uses PBKDF2 with SHA-256 (300,000 iterations) to derive an AES-GCM 256-bit wrapping key from password.
 * @param {string} password
 * @param {string|Uint8Array} saltBase64
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKeyFromPassword(password, saltBase64) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const saltBytes = normalizeSalt(saltBase64);
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 300000,
      hash: 'SHA-256'
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Cleans dashes/whitespace and uses PBKDF2 with SHA-256 (300,000 iterations)
 * to derive an AES-GCM 256-bit wrapping key from recovery key.
 * @param {string} recoveryKeyStr
 * @param {string|Uint8Array} saltBase64
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKeyFromRecoveryKey(recoveryKeyStr, saltBase64) {
  const cleanKey = (recoveryKeyStr || '').replace(/[-\s]/g, '').toUpperCase();
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(cleanKey),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const saltBytes = normalizeSalt(saltBase64);
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 300000,
      hash: 'SHA-256'
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Generates a random 12-byte IV, encrypts raw key with AES-GCM, returns base64 JSON string of { iv, data }.
 * @param {string} keyToWrapRawBase64
 * @param {CryptoKey} wrappingKey
 * @returns {Promise<string>}
 */
export async function wrapKey(keyToWrapRawBase64, wrappingKey) {
  const iv = generateRandomBytes(12);
  const rawKeyBytes = base64ToBytes(keyToWrapRawBase64);
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    wrappingKey,
    rawKeyBytes
  );
  const payload = {
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext))
  };
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(payload)));
}

/**
 * Extracts IV and data, decrypts with AES-GCM, returns raw key base64 string.
 * @param {string|object} wrappedJsonBase64
 * @param {CryptoKey} wrappingKey
 * @returns {Promise<string>}
 */
export async function unwrapKey(wrappedJsonBase64, wrappingKey) {
  let parsed;
  if (typeof wrappedJsonBase64 === 'object' && wrappedJsonBase64 !== null) {
    parsed = wrappedJsonBase64;
  } else {
    let jsonStr = wrappedJsonBase64;
    try {
      const decoded = new TextDecoder().decode(base64ToBytes(wrappedJsonBase64));
      if (decoded.includes('{')) {
        jsonStr = decoded;
      }
    } catch {
      // not base64-encoded json, keep as is
    }
    parsed = JSON.parse(jsonStr);
  }

  const ivBytes = base64ToBytes(parsed.iv);
  const dataBytes = base64ToBytes(parsed.data);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes
    },
    wrappingKey,
    dataBytes
  );
  return bytesToBase64(new Uint8Array(decryptedBuffer));
}

/**
 * Generates 12-byte IV, encrypts with AES-GCM, prepends the 12-byte IV directly to ciphertext Uint8Array,
 * returns combined ArrayBuffer.
 * @param {ArrayBuffer} arrayBuffer
 * @param {CryptoKey} mfkCryptoKey
 * @returns {Promise<ArrayBuffer>}
 */
export async function encryptBinary(arrayBuffer, mfkCryptoKey) {
  const iv = generateRandomBytes(12);
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    mfkCryptoKey,
    arrayBuffer
  );
  const cipherBytes = new Uint8Array(ciphertext);
  const combined = new Uint8Array(iv.length + cipherBytes.length);
  combined.set(iv, 0);
  combined.set(cipherBytes, iv.length);
  return combined.buffer;
}

/**
 * Extracts first 12 bytes as IV, decrypts remaining bytes with AES-GCM, returns decrypted ArrayBuffer.
 * @param {ArrayBuffer} combinedArrayBuffer
 * @param {CryptoKey} mfkCryptoKey
 * @returns {Promise<ArrayBuffer>}
 */
export async function decryptBinary(combinedArrayBuffer, mfkCryptoKey) {
  const combinedBytes = new Uint8Array(combinedArrayBuffer);
  if (combinedBytes.length < 12) {
    throw new Error('Encrypted payload too short (missing IV).');
  }
  const iv = combinedBytes.slice(0, 12);
  const data = combinedBytes.slice(12);
  return window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    mfkCryptoKey,
    data
  );
}

/**
 * PBKDF2-SHA256 (260,000 iterations) for server authentication.
 * Returns base64 encoded hash string matching backend PBKDF2.
 * @param {string} password
 * @param {string|Uint8Array} saltBase64
 * @returns {Promise<string>}
 */
export async function hashPassword(password, saltBase64) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const saltBytes = normalizeSalt(saltBase64);
  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 260000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256 // 256 bits = 32 bytes
  );
  return bytesToBase64(new Uint8Array(derivedBits));
}
