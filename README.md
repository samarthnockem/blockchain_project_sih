# KryptoVault

KryptoVault is a secure document access prototype for the SIH hackathon.

The final frontend lives in `frontend/` and is vanilla HTML, CSS, and
JavaScript. Preserve its current visual design, dark/light theme, pages, and
modals.

## Architecture

- Frontend: client-side Web Crypto file encryption/decryption, AES key
  generation, AES key wrapping, SHA-256 hashing, and MetaMask signing.
- Backend: Node.js, TypeScript, Express, MongoDB, Mongoose, Zod, Helmet,
  express-rate-limit, Pino, Vitest, and Supertest.
- Storage: encrypted file bytes are stored off-chain in MongoDB GridFS
  initially.
- Blockchain: authoritative ownership, hashes, READ/WRITE/NONE permissions,
  and audit events.

## Security Rules

- Plaintext files never reach the backend.
- Raw AES document keys never reach the backend.
- Private encryption keys remain client-side.
- Wallet private keys, seed phrases, plaintext passwords, and password-derived
  secrets never reach the backend.
- Backend blockchain access is read-only unless an endpoint is explicitly
  designed around user-signed MetaMask transactions. The backend does not create
  signing wallets or sign blockchain-changing actions.
- KYC remains a clearly labelled prototype-only mock.
- Folders are organizational only and are not blockchain-based access control.

## Docs

- Backend details: `backend/README.md`
- Frontend guide: `frontend/README (1).txt`
- Integration plan: `docs/FINAL_INTEGRATION_PLAN.md`
