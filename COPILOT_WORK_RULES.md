# KryptoVault Copilot Work Rules

1. Read `COPILOT_PROJECT_CONTEXT.md` and this file before editing.
2. Inspect the current source, tests, configuration, and relevant docs first. Current source wins over old roadmap claims.
3. Make the smallest correct, surgical change. Preserve existing libraries, framework choices, API contracts, UI design, and subsystem boundaries.
4. Do not reintroduce Hardhat Local into normal runtime. Preserve Ethereum Sepolia, chain ID `11155111`, the configured contract, and static browser ABI delivery.
5. Never expose or commit secrets. Keep `.env` files ignored, never print secret values, and never expose RPC credentials, deployer keys, wallet keys, mnemonics, session secrets, or cookies.
6. Never move plaintext files, raw AES keys, document encryption private keys, passwords, password-derived keys, wallet private keys, or seed phrases to the backend, database, blockchain, or logs.
7. Preserve challenge-response wallet authentication, session-derived identity, object-level authorization, recipient wrapped-key isolation, Zod validation, Helmet, rate limits, CORS, and log redaction.
8. Never weaken blockchain verification. Verify expected chain, contract, successful receipt, sender, event, asset, owner/grantee, hash, permission, version, and validity fields as applicable. Fail closed on uncertainty.
9. Treat blockchain permissions as authoritative. Do not authorize protected actions from client-supplied wallet fields or stale MongoDB permission metadata.
10. Distinguish real mode from explicit demo mode. Do not describe simulated localStorage data or mock transactions as production behavior.
11. Preserve the separate browser encryption identity and its local-only private key. Flag recovery/backup implications rather than inventing a recovery mechanism.
12. Run the smallest relevant existing tests/build after changes. Do not start a local Hardhat node, redeploy Sepolia, alter production MongoDB data, or run destructive migrations during routine work.
13. Report root cause, implementation, exact files changed, tests run, and manual verification steps. Never claim MetaMask/browser/manual blockchain behavior was tested unless it was actually accessible and performed.
14. Flag ambiguity or conflicting documentation and inspect further; do not invent behavior or silently modify unrelated functionality.
