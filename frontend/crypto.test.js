const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const cryptoSource = fs.readFileSync(path.join(__dirname, "crypto.js"), "utf8");

assert(!cryptoSource.includes("localStorage"), "crypto identity must not use localStorage");
assert(cryptoSource.includes("indexedDB.open"), "crypto identity must use IndexedDB");
assert(cryptoSource.includes("RSA-OAEP"), "crypto identity must use RSA-OAEP");
assert(cryptoSource.includes("SHA-256"), "crypto identity must use SHA-256");
assert(cryptoSource.includes("generateKey(RSA_OAEP_PARAMS, false"), "RSA private key must be generated non-extractable");
assert(!cryptoSource.includes("exportKey(\"pkcs8\""), "private key must not be exported as PKCS8");
assert(!cryptoSource.includes("exportKey('pkcs8'"), "private key must not be exported as PKCS8");
assert(!cryptoSource.includes("/api/auth"), "document encryption identity must not use MetaMask auth APIs directly");

const context = {
  window: {},
  crypto: webcrypto,
  indexedDB: {
    open() {
      throw new Error("IndexedDB should not be used by pure helper tests.");
    }
  },
  btoa(value) {
    return Buffer.from(value, "binary").toString("base64");
  },
  atob(value) {
    return Buffer.from(value, "base64").toString("binary");
  },
  TextEncoder,
  Uint8Array,
  ArrayBuffer,
  Error
};

vm.createContext(context);
vm.runInContext(cryptoSource, context);

const helpers = context.window.KryptoVaultCrypto.test;
const bytes = new Uint8Array([1, 2, 3, 250, 255]);
const encoded = helpers.arrayBufferToBase64(bytes.buffer);
assert.equal(encoded, "AQID+v8=");
assert.deepEqual(new Uint8Array(helpers.base64ToArrayBuffer(encoded)), bytes);
assert.equal(helpers.normalizeWalletAddress("0xA111111111111111111111111111111111111111"), "0xa111111111111111111111111111111111111111");
assert.throws(() => helpers.normalizeWalletAddress("not-a-wallet"), /valid wallet address/);
assert.equal(
  helpers.identityStoreKey("0xA111111111111111111111111111111111111111"),
  "document-encryption-identity:0xa111111111111111111111111111111111111111"
);

console.log("frontend crypto tests passed");
