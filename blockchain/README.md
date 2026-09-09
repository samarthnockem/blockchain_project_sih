# KryptoVault Blockchain

Minimal Hardhat project for the KryptoVault asset-access contract.

## Commands

```bash
npm install
npm run compile
npm test
```

## Local Demo Setup

Use only the Hardhat local network for this flow. The accounts and ETH are
test-only and have no real value.

Terminal 1:

```bash
cd blockchain
npm install
npm run node
```

Terminal 2:

```bash
cd blockchain
npm run compile
npm run deploy:local
```

The deployment writes:

- `exports/KryptoVaultAccess.local.json` - contract address, chain ID, local
  RPC URL, Bob/Alice addresses, and ABI
- `exports/KryptoVaultAccess.abi.json` - ABI only
- `exports/local.env` - backend-style environment values

Copy the values from `exports/local.env` into `backend/.env`:

```bash
BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
CONTRACT_ADDRESS=<deployed local contract address>
```

Local Hardhat network:

- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency symbol: `ETH`
- Block explorer URL: leave empty

## MetaMask Local Network

1. Open MetaMask.
2. Add a custom network.
3. Use network name `Hardhat Local`.
4. Use RPC URL `http://127.0.0.1:8545`.
5. Use chain ID `31337`.
6. Save and switch to `Hardhat Local`.

## Demo Accounts

When `npm run node` starts, Hardhat prints funded local test accounts and their
private keys. Import only these local Hardhat accounts into MetaMask.

Use:

- Bob = owner = Hardhat account #0
- Alice = recipient = Hardhat account #1

Bob registers assets, grants/revokes access, and can commit versions. Alice can
receive READ or WRITE access. With WRITE access that is currently valid, Alice
can commit a new version/hash.

Never send real funds to these accounts. Never use these deterministic Hardhat
private keys outside local development.

## Contract Scope

`KryptoVaultAccess` stores only:

- asset owner
- current SHA-256 hash
- current version
- READ / WRITE / NONE access permissions
- optional permission validity windows
- immutable audit events

It does not store encrypted files, wrapped keys, emails, names, KYC data, or
other sensitive identity details. User actions are enforced with `msg.sender`;
there is no backend master wallet flow for registering assets, granting access,
revoking access, or committing versions.
