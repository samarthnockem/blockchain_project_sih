# KryptoVault Project Context

**Audit basis:** repository source, configuration, tests, generated static ABI/deployment exports, and startup scripts inspected on 2026-09-12. This document describes current code, not historical roadmap claims.

## 1. Project overview

KryptoVault is a vanilla-browser document storage and sharing prototype. Files are encrypted in the browser, encrypted bytes are stored off-chain in MongoDB GridFS, and Ethereum Sepolia is authoritative for ownership, permissions, current hash, and version. Wallet signatures authenticate users and MetaMask signs blockchain-changing actions.

The repository contains three independently runnable areas:

- `frontend/`: static HTML/CSS/JavaScript application.
- `backend/`: TypeScript Express API and MongoDB integration.
- `blockchain/`: Solidity contract, Hardhat compilation/tests, deployment scripts, and ABI exports.

## 2. Actual repository tree

```text
.
├── README.md
├── setup_guide.md
├── AGENTS.md
├── package.json
├── start-kryptovault.ps1
├── COPILOT_PROJECT_CONTEXT.md
├── COPILOT_WORK_RULES.md
├── docs/
│   └── FINAL_INTEGRATION_PLAN.md
├── frontend/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── api.js
│   ├── crypto.js
│   ├── blockchain.js
│   ├── blockchain-config.js
│   ├── KryptoVaultAccess.abi.json
│   ├── server.js
│   ├── package.json
│   └── *.test.js
├── backend/
│   ├── src/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   ├── auth/
│   │   ├── config/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   └── services/
│   ├── test/setup-env.ts
│   ├── package.json
│   └── *.test.ts
└── blockchain/
    ├── contracts/KryptoVaultAccess.sol
    ├── test/KryptoVaultAccess.test.js
    ├── scripts/
    ├── exports/
    ├── hardhat.config.js
    └── package.json
```

Ignored/generated directories include `node_modules/`, `backend/dist/`, Hardhat `artifacts/` and `cache/`, coverage output, and `.local-startup/` logs.

## 3. Actual tech stack

| Area | Current implementation |
|---|---|
| Frontend | Vanilla HTML, CSS, browser JavaScript; Node static server; ethers.js loaded for Web3 |
| Browser crypto | Web Crypto API: AES-GCM, RSA-OAEP, PBKDF2, SHA-256, IndexedDB |
| Backend | Node.js, TypeScript, Express 5, ethers.js 6, Mongoose 9 |
| Backend security | Zod, Helmet, CORS, express-rate-limit, Pino redaction, strict Mongoose schemas |
| File upload | Multer memory upload with encrypted-byte size limit |
| Storage | MongoDB Atlas plus MongoDB GridFS bucket |
| Blockchain | Solidity 0.8.28, Hardhat 2, Sepolia chain ID `11155111` |
| Testing | Vitest/Supertest backend, Node frontend tests, Hardhat/Mocha contract tests |

The frontend is **not React/Vite/Tailwind** despite older permanent instructions in `AGENTS.md`; the source and package manifests are authoritative and currently use vanilla JavaScript.

## 4. Local runtime architecture

Normal runtime:

```text
Browser + MetaMask
  http://localhost:8000
        │ credentials: include
        ▼
Express backend
  http://localhost:4000
        │
        ├── MongoDB Atlas / secure-vault / GridFS
        └── read-only ethers JsonRpcProvider → Sepolia
                                      └── KryptoVaultAccess
```

The preferred launcher is `.\start-kryptovault.ps1`. It checks folders and `backend/.env`, rejects local MongoDB/local RPC values, verifies Sepolia chain ID `0xaa36a7`, verifies contract bytecode, starts/restarts the backend, waits for `/api/health` and Atlas-backed `/api/ready`, then starts or reuses the frontend. It does **not** start Hardhat Local.

Backend startup connects to MongoDB before listening. In development it binds port `4000`; in production it uses `process.env.PORT` when `NODE_ENV=production`. The frontend static server defaults to port `8000`.

## 5. Production/deployment architecture

There is no infrastructure-as-code or hosting deployment manifest in the repository. The frontend API client currently defaults non-local browsers to:

`https://blockchain-project-sih.onrender.com`

The intended deployment shape is static frontend hosting plus a hosted Express backend plus MongoDB Atlas and Sepolia. This Render URL is hard-coded in `frontend/api.js`; verify/update it before any production deployment. The browser contract ABI is a checked-in static asset at `frontend/KryptoVaultAccess.abi.json`, and `frontend/blockchain-config.js` points to `/KryptoVaultAccess.abi.json`, so the frontend does not require repository-relative Hardhat files at runtime.

## 6. Actual environment variables

### Backend (`backend/.env.example` and `src/config/env.ts`)

`NODE_ENV`, `PORT`, `MONGODB_URI`, `MONGODB_DATABASE`, `CORS_ORIGIN`, `JSON_BODY_LIMIT`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_WINDOW_MS`, `AUTH_RATE_LIMIT_MAX`, `SENSITIVE_ACTION_RATE_LIMIT_WINDOW_MS`, `SENSITIVE_ACTION_RATE_LIMIT_MAX`, `AUTH_NONCE_TTL_MS`, `SESSION_TTL_MS`, `ENCRYPTED_ASSET_MAX_BYTES`, `GRIDFS_BUCKET_NAME`, `ETHEREUM_RPC_URL`, `CONTRACT_ADDRESS`, and `EXPECTED_CHAIN_ID`.

The source also accepts compatibility aliases `BLOCKCHAIN_RPC_URL` for `ETHEREUM_RPC_URL` and `CHAIN_ID` for `EXPECTED_CHAIN_ID`. The example marks local `BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545` and `CHAIN_ID=31337` as optional fallback values, but normal launcher/runtime configuration must use Sepolia.

There is **no `SESSION_SECRET` implementation**. Sessions are currently in-memory, random opaque IDs in `backend/src/auth/session.ts`; they are lost on process restart and do not work as a shared multi-instance session store.

### Blockchain deployment (`blockchain/.env.example`)

`SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` are used only by the Sepolia Hardhat deployment configuration. `DEPLOYER_PRIVATE_KEY` must never be committed or exposed.

### Frontend

`frontend/.env.example` contains `CONTRACT_ADDRESS` and `EXPECTED_CHAIN_ID`, but the current static application uses `frontend/blockchain-config.js` and optional `window.KRYPTO_API_BASE_URL` / `window.KRYPTO_DEMO_MODE` runtime globals instead of a frontend build-time env loader.

## 7. Startup and development commands

Preferred Windows startup:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-kryptovault.ps1
```

Root alias:

```bash
npm run dev:all
```

Manual services:

```bash
cd backend
npm install
npm run dev

cd frontend
npm install
npm run dev
```

Backend validation:

```bash
cd backend
npm test
npm run build
```

Contract validation:

```bash
cd blockchain
npm test
npm run compile
```

Do not start `npm run node` or `npx hardhat node` for normal application startup.

## 8. Frontend architecture

- `index.html` defines dashboard, documents, shared, folders, activity, blockchain, account, security, settings, upload/share/revoke modals.
- `styles.css` contains the visual design and theme.
- `app.js` coordinates UI state, real backend mode, explicit demo mode, wallet events, uploads, sharing, opening, integrity checks, and revocation.
- `api.js` sends `credentials: "include"` requests and selects localhost or the configured hosted backend.
- `crypto.js` owns all document encryption identity and file crypto.
- `blockchain.js` loads the static ABI, validates Sepolia, checks contract bytecode, and sends MetaMask transactions.
- `blockchain-config.js` currently configures contract `0x87becA5241e43607ce2983608B1D479f97cD9a05`, chain `11155111`, public Sepolia RPC fallback, Etherscan URL, and static ABI URL.

Demo mode is explicit (`window.KRYPTO_DEMO_MODE=true` or localStorage flag). It uses localStorage documents/folders/activity, generated demo wallets, simulated hashes/transactions, and simulated tampering. Demo data is not backend or blockchain security behavior.

Account switching is handled through `accountsChanged` and `chainChanged`: frontend state is cleared, the old session is logged out, the new wallet reauthenticates, the encryption identity is registered, and workspace data is reloaded.

## 9. Backend architecture

`src/app.ts` installs request IDs, Helmet, strict configured CORS with credentials, JSON limits, in-memory session attachment, Pino request logging, general rate limiting, routers, 404 handling, and centralized error handling.

Routes:

- `/api/health`, `/api/ready`
- `/api/auth/challenge`, `/api/auth/verify`, `/api/auth/logout`, `/api/auth/me`
- `/api/users/me`, `/api/users/me/encryption-key`, `/api/users/:wallet/public-key`
- `/api/kyc/status`, `/api/kyc/mock-verify`
- `/api/folders`
- `/api/assets`, `/api/assets/my`, `/api/assets/shared-with-me`
- asset folder, blockchain, integrity, activity, access, open, and ciphertext routes
- `/api/blockchain/records`
- `/api/activity`

Protected routes use `req.auth.walletAddress` derived from the server-side session. Asset and folder queries scope ownership to that identity. Blockchain reads use a read-only provider and fail closed when chain, contract, permission, hash, version, receipt, or event verification fails.

## 10. MongoDB models/collections

Exact current Mongoose models:

- **User** (`models/user.ts`): lowercase `walletAddress`, `publicEncryptionKey`, `displayName`, `email`, mock `kycStatus`, `verificationMethod`, `verifiedAt`.
- **Asset** (`models/asset.ts`): `ownerWallet`, filename, original size/mime type, `blockchainAssetId`, `currentVersion`, current `sha256`, status, password flag, folder, registration tx/block, blockchain verification status.
- **AssetVersion** (`models/asset-version.ts`): asset/version, GridFS storage reference, AES-GCM metadata, plaintext SHA-256, `createdBy`, optional commit message and blockchain tx hash.
- **WrappedKey** (`models/wrapped-key.ts`): asset, recipient wallet, wrapped AES key, version, RSA/password wrapping metadata, active flag. Unique by asset/wallet/version.
- **AccessGrant** (`models/access-grant.ts`): asset, owner/grantee wallets, READ/WRITE type, validity, reason, blockchain tx, ACTIVE/REVOKED/EXPIRED status.
- **Folder** (`models/folder.ts`): owner, name, optional parent folder. Organizational only.
- **AuditEvent** (`models/audit-event.ts`): wallet, optional asset, action/detail, optional blockchain tx, timestamp.
- **AssetAuditEvent** (`models/asset-audit-event.ts`): asset/owner/actor, upload/folder/access/strong-revoke event type, folder transition fields.

Schemas use `strict: "throw"` and schema guards reject forbidden secret fields. There is no separate `Document` or `AuditEvent / AssetAuditEvent` combined collection.

## 11. GridFS/storage flow

`services/encrypted-asset-storage.ts` writes opaque ciphertext to a configurable GridFS bucket, default `encryptedAssets`, under generated IDs like `enc_asset_<uuid>`. It enforces `ENCRYPTED_ASSET_MAX_BYTES` (default 25 MiB), validates filenames/storage IDs, and never decrypts or parses bytes.

`POST /api/assets` accepts only the multipart field `encryptedFile` with `application/octet-stream` plus safe metadata. It stores GridFS bytes first, creates `Asset`, version 1, owner `WrappedKey`, and audit records, and deletes the GridFS object if database creation fails.

## 12. Wallet authentication flow

1. Browser requests `GET /api/auth/challenge`.
2. Backend creates a random 32-byte hex nonce, a fixed message, and a single-use expiring in-memory challenge.
3. MetaMask signs with `personal_sign`.
4. Browser posts message, nonce, and signature to `/api/auth/verify`.
5. Backend consumes the exact unexpired challenge, recovers the signer with ethers `verifyMessage`, creates an opaque in-memory session, and sets an HttpOnly cookie.
6. Subsequent protected requests use the session-derived wallet; arbitrary wallet fields are not trusted.

Cookie behavior is `SameSite=Lax` for local HTTP and `SameSite=None; Secure` for HTTPS/cross-site configurations. The frontend always includes credentials. The current session implementation is process-local and is a production scalability limitation.

## 13. Encryption identity flow

MetaMask identity and document encryption identity are separate.

`crypto.js` generates a non-extractable browser Web Crypto RSA-OAEP 2048/SHA-256 key pair, stores the CryptoKeys in IndexedDB keyed by normalized wallet address, and exports only the public SPKI key. Authentication calls `PUT /api/users/me/encryption-key`. Recipient public keys are fetched from `/api/users/:wallet/public-key`.

Clearing IndexedDB/browser profile can make non-password document keys unrecoverable; there is no implemented recovery/backup design.

## 14. File encryption and key wrapping flow

Normal upload:

1. Browser reads plaintext locally and computes SHA-256.
2. Browser generates a random AES-256-GCM key and 12-byte IV.
3. Browser encrypts bytes; GCM tag remains included in ciphertext.
4. Browser wraps the AES key with the owner RSA-OAEP public key.
5. Backend receives ciphertext, hash, AES-GCM metadata, wrapped key, and safe metadata only.

Optional password upload:

- Browser derives an AES key-encryption key with PBKDF2-SHA-256, default 310,000 iterations.
- Browser AES-GCM encrypts the raw document AES key.
- Backend stores the password-wrapped key, salt, iteration count, wrapping IV, and metadata only.
- Password-protected uploads deliberately do not also store an owner RSA wrapping.

Backend upload schemas reject raw-key, plaintext, password, private-key, mnemonic, and similar fields recursively.

## 15. Upload flow

`app.js:startEncryptedUpload()` uploads ciphertext and metadata, receives a Mongo asset ID in `PENDING_BLOCKCHAIN`, calls MetaMask `registerAsset(keccak256(applicationAssetId), sha256)`, waits for one confirmation, then calls `/api/assets/:assetId/blockchain-sync`.

The backend verification service checks expected Sepolia chain, configured contract bytecode, successful receipt, sender/owner, contract target, `AssetRegistered` event, derived asset ID, owner, hash, and version 1 before setting `ACTIVE` and `blockchainVerificationStatus: "verified"`.

## 16. Sharing flow

The owner retrieves a recipient public key, locally recovers the current AES key from the owner open response, RSA-wraps it for the recipient, signs `grantAccess` in MetaMask, waits for confirmation, and posts the tx hash plus recipient wrapped key to `grant-sync`.

The backend independently verifies `AccessGranted` fields (asset, owner, grantee, permission, validity window) before storing `AccessGrant`, recipient `WrappedKey`, and audit records. MongoDB grants are metadata; blockchain permission is authoritative.

## 17. Secure open/decrypt flow

`GET /api/assets/:assetId/open` requires session authentication, an ACTIVE verified asset, successful on-chain permission READ/WRITE, a current on-chain version/hash matching an `AssetVersion`, and an active wrapped key for the authenticated wallet. It returns ciphertext URL, encryption metadata, and only that wallet's wrapped key (`EK_User`).

The separate ciphertext route repeats authorization and returns opaque bytes. The browser unwraps or password-decrypts the AES key locally, decrypts locally, hashes the plaintext, and compares it to the authoritative hash before opening it.

## 18. READ vs WRITE behavior

- `NONE`: no open/download/decrypt access.
- `READ`: may open/decrypt current content, but the contract rejects `commitVersion`.
- `WRITE`: may open/decrypt and the contract permits `commitVersion`.
- Owner: contract reports WRITE-equivalent permission and may grant/revoke.

The current UI implements sharing/opening but does not expose a general non-strong version-edit/commit workflow for WRITE users. Strong revoke uses owner-signed version commit.

## 19. Weak revoke flow

Owner signs `revokeAccess` on Sepolia. Backend `/revoke-sync` verifies receipt, target, sender, and `AccessRevoked` event, confirms current on-chain permission is NONE, marks matching grants revoked, deactivates recipient wrapped keys, and records audit events. AES key material is not rotated; previously downloaded plaintext or old keys cannot be erased.

## 20. Strong revoke flow

Implemented end-to-end:

1. Owner first performs on-chain revoke and backend revoke sync.
2. Frontend calls strong-revoke prepare; backend confirms owner, target permission NONE, current hash/version synchronization, and collects remaining authorized wallets.
3. Browser decrypts current content locally, generates K2, re-encrypts locally, hashes plaintext, and wraps K2 for every remaining authorized wallet. The revoked wallet is excluded.
4. Owner signs `commitVersion`, waits for confirmation, and submits ciphertext plus wrapped-key set to finalize.
5. Backend verifies `VersionCommitted`, checks sequential version and recipient set, stores new GridFS ciphertext/version/wrapped keys, deactivates prior-version keys, updates Asset current version/hash, and records audit events.

The chain/database workflow cannot be globally atomic across a user transaction and MongoDB; failures after the revoke transaction can leave a revoked asset awaiting rotation. The code fails closed and does not invent a replacement key.

## 21. Versioning/integrity flow

`AssetVersion` stores every implemented uploaded/strong-revoked encrypted version with hash, version, creator, storage reference, encryption metadata, optional message, and commit transaction. The contract stores current hash/version and emits `VersionCommitted`. `/integrity` checks current blockchain hash/version against the stored version; the browser additionally decrypts and hashes plaintext.

There is no general backend route/UI for arbitrary WRITE-user version commits beyond the strong-revoke finalize path.

## 22. Blockchain contract functions

`KryptoVaultAccess.sol` exposes:

- `registerAsset(assetId, sha256Hash)`
- `grantAccess(assetId, grantee, permission, validFrom, validUntil)`
- `revokeAccess(assetId, grantee)`
- `commitVersion(assetId, sha256Hash)`
- `getAsset(assetId)`
- `ownerOf(assetId)`
- `currentHashOf(assetId)`
- `currentVersionOf(assetId)`
- `getPermission(assetId, user)`
- `getAccessWindow(assetId, user)`

Permissions are enum values `NONE=0`, `READ=1`, `WRITE=2`. Validity windows are enforced by `getPermission`.

## 23. Blockchain events

- `AssetRegistered(assetId, owner, sha256Hash, version)`
- `AccessGranted(assetId, owner, grantee, permission, validFrom, validUntil)`
- `AccessRevoked(assetId, owner, grantee)`
- `VersionCommitted(assetId, committer, sha256Hash, version)`

## 24. What is stored on-chain

Asset numeric reference, owner address, current SHA-256 hash, current version, current READ/WRITE/NONE permission windows, and immutable action events. No files, wrapped keys, public encryption keys, names, email, KYC, or identity documents are stored on-chain.

## 25. What is stored off-chain

MongoDB stores wallet/profile metadata, public encryption keys, asset metadata, version metadata, wrapped AES keys, access grant metadata, folder metadata, and audit records. GridFS stores encrypted file bytes only. Raw AES keys, private encryption keys, wallet private keys, seed phrases, plaintext passwords, and plaintext file bytes are not intended to be stored.

## 26. Security invariants

- Plaintext files are encrypted before backend upload.
- Raw AES keys never form an accepted backend field.
- Private encryption keys remain in browser IndexedDB.
- Session wallet identity is authoritative for protected API actions.
- Object-level authorization scopes owner and access checks.
- Blockchain state is authoritative for asset access.
- Blockchain verification fails closed and validates events, not only receipt status.
- Recipient key responses are wallet-specific.
- Zod strict schemas and Mongoose strict schemas reject unknown/forbidden input.
- Helmet, CORS, request limits, rate limits, centralized errors, and Pino redaction are enabled.
- Secrets belong in ignored environment files only.
- KYC is mock/demo-only.
- The system is not “unhackable”; browser/device recovery and in-memory session limitations remain.

## 27. Current deployment configuration

- Network: Ethereum Sepolia.
- Chain ID: `11155111` (`0xaa36a7`).
- Contract: `0x87becA5241e43607ce2983608B1D479f97cD9a05`.
- Frontend local URL: `http://localhost:8000`.
- Backend local URL: `http://localhost:4000`.
- Backend health: `http://localhost:4000/api/health`.
- Backend readiness: `http://localhost:4000/api/ready`.
- MongoDB intended database: `secure-vault`; Atlas URI is supplied through ignored `backend/.env`.
- Browser ABI: `frontend/KryptoVaultAccess.abi.json`.
- Hardhat deployment/redeployment is not required for normal runtime.

## 28. Testing setup

Validated during this audit:

- Backend: 18 Vitest files, 204 tests passed.
- Backend TypeScript build passed.
- Frontend crypto and blockchain tests passed.
- Hardhat contract tests: 7 passed.
- Hardhat compile completed with nothing to compile.

Tests use mocks/in-memory fixtures where appropriate; no audit command started a local Hardhat node, redeployed Sepolia, or changed MongoDB data.

## 29. Completed features

**IMPLEMENTED:** backend foundation; strict validation/security middleware; wallet challenge/signature auth; in-memory sessions; user profile and public-key APIs; mock KYC metadata; folders; encrypted GridFS upload; AES-GCM/RSA-OAEP/PBKDF2 browser crypto; asset registration and receipt/event sync; read-only Sepolia verification; READ/WRITE grants and grant sync; Shared With Me; recipient-isolated open/ciphertext responses; integrity endpoint and UI; audit/activity records; weak revoke; strong revoke key rotation/version finalize; contract functions/events; static ABI; account/chain change reauthentication; Sepolia launcher checks; frontend/backend/contract tests.

## 30. Partial/incomplete features

**PARTIAL:**

- Production session architecture: sessions are in-memory and have no `SESSION_SECRET` or shared store.
- Production deployment: frontend has a hard-coded Render backend URL and no deployment manifest.
- General version editing: contract support and version schema exist, but a general WRITE-user edit/commit API/UI is not implemented.
- Password recovery/rotation/backup: intentionally absent.
- Browser key recovery: IndexedDB loss can make RSA identity unavailable.
- Demo/real parity: explicit demo mode still simulates storage, transactions, KYC, and tampering.
- Cross-service strong revoke atomicity: user-signed chain actions and MongoDB changes cannot be one atomic transaction.

## 31. Known bugs/TODOs

- `backend/README.md`, `frontend/README.md`, and `blockchain/README.md` still contain legacy/local Hardhat instructions that conflict with the Sepolia-only normal runtime policy. Treat source and `start-kryptovault.ps1` as current behavior.
- `frontend/README.md` and setup text describe some planned/demo functions more broadly than current real-mode routes; re-check source before extending them.
- The backend uses `autoIndex: false` in production; indexes must be provisioned deliberately for production.
- The in-memory challenge/session maps are not suitable for multi-instance deployment or restart persistence.
- No production KYC provider or identity-document workflow exists.
- No general WRITE-user content-edit workflow exists.
- No implemented key backup/recovery mechanism exists.

No committed secret values were found by the tracked-file audit. Ignored local `backend/.env` and `blockchain/.env` files exist in the working tree and were not printed.

## 32. Exact files responsible for major subsystems

| Subsystem | Files |
|---|---|
| Startup/runtime | `start-kryptovault.ps1`, root `package.json`, `backend/src/server.ts`, `frontend/server.js` |
| Frontend UI/state | `frontend/index.html`, `frontend/styles.css`, `frontend/app.js` |
| API client | `frontend/api.js` |
| Browser crypto | `frontend/crypto.js`, `frontend/crypto.test.js` |
| Browser blockchain | `frontend/blockchain.js`, `frontend/blockchain-config.js`, `frontend/KryptoVaultAccess.abi.json` |
| Backend composition | `backend/src/app.ts`, `backend/src/server.ts` |
| Environment/database/logging | `backend/src/config/env.ts`, `database.ts`, `logger.ts`, `log-redaction.ts` |
| Auth/session | `backend/src/auth/challenges.ts`, `session.ts`, `routes/auth.ts`, `middleware/require-auth.ts` |
| Asset APIs | `backend/src/routes/assets.ts`, `middleware/asset-authorization.ts` |
| Blockchain verification | `backend/src/services/blockchain-read.ts`, `routes/blockchain.ts` |
| Encrypted storage | `backend/src/services/encrypted-asset-storage.ts` |
| Models | `backend/src/models/*.ts` |
| Audit/activity | `backend/src/services/audit-events.ts`, `routes/activity.ts`, audit models |
| Smart contract | `blockchain/contracts/KryptoVaultAccess.sol` |
| Contract deployment/export | `blockchain/hardhat.config.js`, `blockchain/scripts/*.js`, `blockchain/exports/*` |

## 33. Rules Copilot must follow before future edits

1. Read this file and `COPILOT_WORK_RULES.md` first.
2. Inspect current source and tests; do not treat old roadmap/README text as authoritative.
3. Preserve vanilla frontend, Express/TypeScript backend, MongoDB/GridFS, ethers.js, Web Crypto, and Solidity architecture unless an explicit change is requested.
4. Preserve Sepolia chain ID `11155111` and the configured deployed contract for normal runtime.
5. Never reintroduce Hardhat Local startup, localhost:8545, chain 31337, or funded demo accounts into normal runtime.
6. Keep plaintext files, raw AES keys, private keys, seed phrases, passwords, and password-derived secrets client-side and out of logs/database/API payloads.
7. Keep wallet/session identity authoritative; never trust a client wallet override.
8. Preserve object-level authorization and fail-closed blockchain/event verification.
9. Preserve recipient wrapped-key isolation.
10. Make the smallest safe change, update directly affected docs/tests, run relevant existing tests/builds, and report exact files changed.
11. Clearly distinguish implemented, partial, assumed, and manually unverified browser/MetaMask behavior.
