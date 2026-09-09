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

## Local Development

Start the backend first:

```bash
cd backend
npm install
npm run dev
```

Start the frontend in a second terminal:

```bash
cd frontend
npm run dev
```

Open `http://localhost:8000`.

Expected backend checks:

- `http://localhost:4000/api/health`
- `http://localhost:4000/api/ready`

For local integration, keep `backend/.env` set to `PORT=4000`,
`CORS_ORIGIN=http://localhost:8000`, and the existing MongoDB Atlas
`MONGODB_URI`.

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
- Frontend guide: `frontend/README.md`
- Local blockchain demo: `blockchain/README.md`
- Integration plan: `docs/FINAL_INTEGRATION_PLAN.md`
