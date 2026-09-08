(function () {
  "use strict";

  const DB_NAME = "kryptovault-crypto-identity";
  const DB_VERSION = 1;
  const STORE_NAME = "keys";
  const IDENTITY_KEY_PREFIX = "document-encryption-identity";
  const RSA_OAEP_PARAMS = {
    name: "RSA-OAEP",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256"
  };
  const AES_GCM_PARAMS = {
    name: "AES-GCM",
    length: 256
  };

  function requireWebCrypto() {
    if (!globalThis.crypto?.subtle) {
      throw new Error("Web Crypto is required for document encryption identity.");
    }
  }

  function requireIndexedDb() {
    if (!globalThis.indexedDB) {
      throw new Error("IndexedDB is required to store the document encryption private key.");
    }
  }

  function normalizeWalletAddress(walletAddress) {
    const normalized = String(walletAddress || "").trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
      throw new Error("A valid wallet address is required for the document encryption identity.");
    }
    return normalized;
  }

  function identityStoreKey(walletAddress) {
    return `${IDENTITY_KEY_PREFIX}:${normalizeWalletAddress(walletAddress)}`;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async function sha256Base64Url(value) {
    const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
    const digest = await crypto.subtle.digest("SHA-256", input);
    return arrayBufferToBase64(digest).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }

  function openDatabase() {
    requireIndexedDb();

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onerror = () => reject(request.error || new Error("Could not open crypto identity database."));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function readStoredIdentity(walletAddress) {
    const db = await openDatabase();
    const storeKey = identityStoreKey(walletAddress);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(storeKey);

      request.onerror = () => reject(request.error || new Error("Could not read encryption identity."));
      request.onsuccess = () => resolve(request.result || null);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error("Could not read encryption identity."));
      };
    });
  }

  async function writeStoredIdentity(walletAddress, identity) {
    const db = await openDatabase();
    const storeKey = identityStoreKey(walletAddress);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(identity, storeKey);

      request.onerror = () => reject(request.error || new Error("Could not store encryption identity."));
      request.onsuccess = () => resolve();
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error("Could not store encryption identity."));
      };
    });
  }

  async function deleteStoredIdentity(walletAddress) {
    const db = await openDatabase();
    const storeKey = identityStoreKey(walletAddress);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(storeKey);

      request.onerror = () => reject(request.error || new Error("Could not delete encryption identity."));
      request.onsuccess = () => resolve();
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error("Could not delete encryption identity."));
      };
    });
  }

  async function exportPublicKey(publicKey) {
    const publicKeyBytes = await crypto.subtle.exportKey("spki", publicKey);
    return arrayBufferToBase64(publicKeyBytes);
  }

  async function importPublicKey(publicEncryptionKey) {
    requireWebCrypto();
    return crypto.subtle.importKey(
      "spki",
      base64ToArrayBuffer(publicEncryptionKey),
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["wrapKey"]
    );
  }

  async function generateDocumentEncryptionIdentity(walletAddress) {
    requireWebCrypto();
    requireIndexedDb();
    const ownerWallet = normalizeWalletAddress(walletAddress);

    const keyPair = await crypto.subtle.generateKey(RSA_OAEP_PARAMS, false, ["wrapKey", "unwrapKey"]);
    const publicEncryptionKey = await exportPublicKey(keyPair.publicKey);
    const keyId = await sha256Base64Url(publicEncryptionKey);
    const identity = {
      keyId,
      walletAddress: ownerWallet,
      algorithm: "RSA-OAEP",
      hash: "SHA-256",
      createdAt: new Date().toISOString(),
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      publicEncryptionKey
    };

    await writeStoredIdentity(ownerWallet, identity);
    return identity;
  }

  async function getDocumentEncryptionIdentity(walletAddress) {
    const ownerWallet = normalizeWalletAddress(walletAddress);
    const existing = await readStoredIdentity(ownerWallet);
    if (existing?.publicKey && existing?.privateKey && existing?.publicEncryptionKey) {
      return existing;
    }

    return generateDocumentEncryptionIdentity(ownerWallet);
  }

  async function ensureDocumentEncryptionIdentityRegistered(walletAddress) {
    if (!window.KryptoVaultApi) {
      throw new Error("API client is required to register the document encryption public key.");
    }

    const identity = await getDocumentEncryptionIdentity(walletAddress);
    await window.KryptoVaultApi.put("/api/users/me/encryption-key", {
      publicEncryptionKey: identity.publicEncryptionKey
    });
    return {
      keyId: identity.keyId,
      algorithm: identity.algorithm,
      hash: identity.hash,
      publicEncryptionKey: identity.publicEncryptionKey
    };
  }

  async function getPublicEncryptionKey(walletAddress) {
    if (!window.KryptoVaultApi) {
      throw new Error("API client is required to retrieve public encryption keys.");
    }

    return window.KryptoVaultApi.get(`/api/users/${encodeURIComponent(walletAddress)}/public-key`);
  }

  async function generateDocumentAesKey() {
    requireWebCrypto();
    return crypto.subtle.generateKey(AES_GCM_PARAMS, true, ["encrypt", "decrypt"]);
  }

  async function wrapDocumentAesKey(aesKey, publicEncryptionKey) {
    const wrappingKey = await importPublicKey(publicEncryptionKey);
    const wrapped = await crypto.subtle.wrapKey("raw", aesKey, wrappingKey, { name: "RSA-OAEP" });
    return arrayBufferToBase64(wrapped);
  }

  async function unwrapDocumentAesKey(wrappedAESKey, walletAddress) {
    const identity = await getDocumentEncryptionIdentity(walletAddress);
    return crypto.subtle.unwrapKey(
      "raw",
      base64ToArrayBuffer(wrappedAESKey),
      identity.privateKey,
      { name: "RSA-OAEP" },
      AES_GCM_PARAMS,
      false,
      ["decrypt"]
    );
  }

  const api = {
    generateDocumentEncryptionIdentity,
    getDocumentEncryptionIdentity,
    ensureDocumentEncryptionIdentityRegistered,
    getPublicEncryptionKey,
    generateDocumentAesKey,
    wrapDocumentAesKey,
    unwrapDocumentAesKey,
    deleteStoredIdentity,
    test: {
      arrayBufferToBase64,
      base64ToArrayBuffer,
      sha256Base64Url,
      normalizeWalletAddress,
      identityStoreKey
    }
  };

  window.KryptoVaultCrypto = api;
})();
