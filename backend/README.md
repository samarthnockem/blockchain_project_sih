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
- `PUT /api/users/me/encryption-key` stores the authenticated user's public encryption key.
- `GET /api/users/:wallet/public-key` returns a user's public encryption key.

## Current Scope

This backend currently includes only the Express app, server startup, MongoDB connection lifecycle, readiness checks, security headers, strict CORS, JSON parsing with a configurable size limit, request IDs, Pino logging, centralized 404/error handling, environment validation, graceful shutdown, and tests.

API rate limits are configurable with `RATE_LIMIT_*` environment variables. Stricter authentication and sensitive-action limiters are available for future routes.

Wallet authentication uses a MetaMask-compatible challenge/signature flow. The backend never asks for or receives wallet private keys.

Blockchain integration, file upload, and asset business logic are intentionally not implemented yet.
