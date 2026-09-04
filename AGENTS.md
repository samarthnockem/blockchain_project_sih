# Secure Vault Repository Instructions

These instructions are permanent architecture, security, and coding rules for this repository. Read this file before making implementation changes.

## Project Context

Secure Vault is a hackathon project. Prefer clear, simple implementations that can be demonstrated reliably. Avoid unnecessary frameworks, broad rewrites, and over-engineered abstractions.

## Architecture

### Frontend

- Use React with Vite.
- Use Tailwind CSS for styling.
- Use MetaMask for wallet connection and signing.
- Use `ethers.js` for Web3 interactions.
- Perform file encryption and decryption client-side.
- Never send plaintext files, raw AES document keys, wallet private keys, or document encryption private keys to the backend.

### Backend

- Use Node.js with Express.
- Use MongoDB for persistence.
- Backend APIs handle metadata, authorization checks, mock KYC state, issuer trust configuration, and off-chain encrypted asset references.
- The backend must not receive or store plaintext files, raw document AES keys, wallet private keys, or users' document encryption private keys.

### Blockchain

- Use Solidity smart contracts.
- Use Hardhat for development, testing, and deployment scripts.
- Use the local Hardhat network during development.
- Use Sepolia for the final demo.
- Smart contracts store ownership, hashes, permissions, and audit events.
- Encrypted files stay off-chain.
- Never place sensitive identity information on-chain.

### Web3

- Use MetaMask as the wallet provider.
- Use `ethers.js` for contract calls, wallet signatures, and provider interactions.

### Cryptography

- Use AES-256-GCM for asset encryption.
- Use SHA-256 for file fingerprinting.
- Each user has a separate public/private encryption key pair.
- Store wrapped AES keys per authorized user.
- Encryption and decryption happen client-side.
- Raw document AES keys must never be stored.

### Identity

- Use wallet authentication.
- Support verifiable credentials.
- Support trusted credential issuers.
- Use mock KYC initially for the hackathon implementation.
- Do not put sensitive identity details on-chain.

## Permanent Security Rules

- Never store plaintext files.
- Never store raw document AES keys.
- Never store wallet private keys.
- Never send document encryption private keys to the backend.
- Never place sensitive identity information on-chain.
- Smart contracts store ownership, hashes, permissions, and audit events only.
- Encrypted files stay off-chain.
- Treat frontend clients as untrusted for authorization decisions.
- Enforce authorization in backend routes and smart contracts where applicable.
- Keep secrets, private keys, mnemonics, RPC credentials, and production environment files out of git.

## Development Rules

- This is a hackathon project; optimize for a working, understandable demo.
- Prefer simple implementations.
- Do not introduce unnecessary frameworks.
- Make small changes.
- Do not modify unrelated files.
- Keep frontend, backend, blockchain, and docs responsibilities separate.
- Read relevant Markdown files before editing.
- Update Markdown files when architecture, setup, behavior, or security assumptions change.
- Run relevant tests after implementation when tests exist.
- Briefly summarize changed files after each implementation.

## Documentation Rules

- `README.md` explains project purpose, setup, run commands, and demo flow.
- `docs/` contains architecture, security notes, decisions, and setup details.
- Record important technical decisions before adding major dependencies or changing architecture.
- Keep documentation practical and current enough for hackathon teammates to follow.

