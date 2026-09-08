# Secure Vault Backend

Minimal Node.js, TypeScript, and Express backend for the Secure Vault SIH hackathon demo.

## Stack

- Node.js
- TypeScript
- Express
- `ethers.js`
- MongoDB with Mongoose
- Zod
- Helmet
- `express-rate-limit`
- Pino
- Vitest and Supertest

## Commands

```bash
npm install
npm run dev
npm run build
npm test
```

Copy `.env.example` to `.env` for local development. Do not commit `.env`.

`MONGODB_URI` must be set in the environment before the server starts.

## Routes

- `GET /api/health` returns basic service health.
- `GET /api/ready` returns whether the backend is connected to MongoDB.
- `GET /api/auth/challenge` returns a MetaMask-compatible message and nonce to sign.
- `POST /api/auth/verify` verifies the signature and creates a server-side session.
- `POST /api/auth/logout` clears the current session.
- `GET /api/auth/me` returns the authenticated wallet for the current session.
- `POST /api/assets` accepts an authenticated multipart upload containing encrypted file bytes plus safe metadata, then creates asset metadata, an encrypted storage reference, and the owner's wrapped key.
- `GET /api/assets/:assetId/open` returns encrypted asset bytes and only the authenticated wallet's wrapped key after blockchain permission verification.
- `GET /api/users/me` returns the authenticated user's safe profile using the verified session wallet.
- `PATCH /api/users/me` updates only `displayName` and `email` for the authenticated session wallet.
- `PUT /api/users/me/encryption-key` stores the authenticated user's public encryption key.
- `GET /api/users/:wallet/public-key` returns a user's public encryption key.
- `GET /api/kyc/status` returns safe mock KYC metadata for the authenticated session wallet.
- `POST /api/kyc/mock-verify` is demo-only mock KYC. It stores status metadata only and does not accept identity documents or identity numbers.

## Current Scope

This backend currently includes the Express app, server startup, MongoDB connection lifecycle, readiness checks, security headers, strict CORS, JSON parsing with a configurable size limit, request IDs, Pino logging, centralized 404/error handling, environment validation, graceful shutdown, wallet authentication, safe user profile metadata, public encryption key metadata, encrypted asset upload/open flows, GridFS encrypted-byte storage, read-only blockchain verification, and tests.

API rate limits are configurable with `RATE_LIMIT_*` environment variables. Stricter authentication and sensitive-action limiters are available for future routes.

Wallet authentication uses a MetaMask-compatible challenge/signature flow. The backend never asks for or receives wallet private keys, seed phrases, plaintext passwords, raw AES keys, plaintext files, identity document contents, identity document numbers, or private document encryption keys.

Mock KYC is prototype-only. It stores only the authenticated `walletAddress`, `kycStatus` (`PENDING`, `VERIFIED`, or `REJECTED`), `verificationMethod: "MOCK"`, and `verifiedAt` when applicable.

Encrypted asset storage stores opaque encrypted bytes in MongoDB GridFS using server-generated storage identifiers, keeps original filenames only as metadata, enforces `ENCRYPTED_ASSET_MAX_BYTES`, and never decrypts or parses file contents. `POST /api/assets` requires authentication and accepts the encrypted file in multipart field `encryptedFile`; uploads must use `application/octet-stream`, declared `AES-256-GCM` encryption metadata, and owner `RSA-OAEP` wrapping metadata. Raw AES keys, plaintext file fields, file passwords, private keys, seed phrases, mnemonic/passphrase aliases, and owner wallet overrides are rejected.

Blockchain reads are available through a backend service abstraction configured by `BLOCKCHAIN_RPC_URL`, `CONTRACT_ADDRESS`, and `CHAIN_ID`. The service creates a read-only ethers provider/contract, never creates a signing wallet, never signs transactions, and fails closed when ownership, permission, hash, or version verification cannot be completed. Blockchain-changing actions must be signed by the user with MetaMask.

Reusable asset authorization helpers enforce owner, read, and write checks from blockchain state only. MongoDB permission fields are not trusted for authorization decisions.

Broader asset business logic is intentionally not implemented yet.
