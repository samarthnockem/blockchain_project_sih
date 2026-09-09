(function () {
  "use strict";

  const Permission = Object.freeze({
    NONE: 0,
    READ: 1,
    WRITE: 2
  });

  const defaultConfig = Object.freeze({
    expectedChainId: 31337,
    expectedChainName: "Hardhat Local",
    deploymentUrl: "/blockchain/exports/KryptoVaultAccess.local.json",
    rpcUrls: ["http://127.0.0.1:8545"],
    nativeCurrency: {
      name: "ETH",
      symbol: "ETH",
      decimals: 18
    }
  });

  let cachedConfig = null;

  class BlockchainError extends Error {
    constructor(message, code, details = {}) {
      super(message);
      this.name = "BlockchainError";
      this.code = code;
      this.details = details;
    }
  }

  class WrongNetworkError extends BlockchainError {
    constructor(expectedChainId, actualChainId, expectedChainName) {
      super(
        `Wrong network. Switch MetaMask to ${expectedChainName} (chain ID ${expectedChainId}). Current chain ID: ${actualChainId}.`,
        "WRONG_NETWORK",
        { expectedChainId, actualChainId, expectedChainName }
      );
      this.name = "WrongNetworkError";
    }
  }

  function requireEthers() {
    if (!window.ethers) {
      throw new BlockchainError("ethers.js is not loaded. Run npm install in frontend/ and restart the frontend server.", "ETHERS_NOT_LOADED");
    }
    return window.ethers;
  }

  function requireMetaMask() {
    if (!window.ethereum) {
      throw new BlockchainError("MetaMask is not available. Install MetaMask and open KryptoVault in that browser.", "METAMASK_NOT_AVAILABLE");
    }
    return window.ethereum;
  }

  async function loadConfig() {
    if (cachedConfig) return cachedConfig;

    const configSource = { ...defaultConfig, ...(window.KRYPTO_BLOCKCHAIN_CONFIG || {}) };
    let deployment = {};

    if (configSource.deploymentUrl) {
      const response = await fetch(configSource.deploymentUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new BlockchainError(
          `Unable to load blockchain deployment config from ${configSource.deploymentUrl}. Run npm run deploy:local in blockchain/.`,
          "BLOCKCHAIN_CONFIG_NOT_FOUND",
          { deploymentUrl: configSource.deploymentUrl, status: response.status }
        );
      }
      deployment = await response.json();
    }

    const ethers = requireEthers();
    const expectedChainId = Number(configSource.expectedChainId || deployment.chainId);
    const contractAddress = configSource.contractAddress || deployment.contractAddress;
    const abi = configSource.abi || deployment.abi;

    if (!Number.isInteger(expectedChainId) || expectedChainId <= 0) {
      throw new BlockchainError("Blockchain config is missing a valid expected chain ID.", "INVALID_BLOCKCHAIN_CONFIG");
    }
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      throw new BlockchainError("Blockchain config is missing a valid contract address.", "INVALID_BLOCKCHAIN_CONFIG");
    }
    if (!Array.isArray(abi) || abi.length === 0) {
      throw new BlockchainError("Blockchain config is missing the contract ABI.", "INVALID_BLOCKCHAIN_CONFIG");
    }

    cachedConfig = {
      ...configSource,
      ...deployment,
      expectedChainId,
      expectedChainName: configSource.expectedChainName || deployment.network || `chain ${expectedChainId}`,
      contractAddress,
      abi
    };
    return cachedConfig;
  }

  async function assertExpectedChain(provider, config) {
    const network = await provider.getNetwork();
    const actualChainId = Number(network.chainId);
    if (actualChainId !== config.expectedChainId) {
      throw new WrongNetworkError(config.expectedChainId, actualChainId, config.expectedChainName);
    }
    return actualChainId;
  }

  async function assertContractDeployed(provider, config) {
    const code = await provider.getCode(config.contractAddress);
    if (!code || code === "0x") {
      throw new BlockchainError(
        `KryptoVault contract is not deployed at ${config.contractAddress} on ${config.expectedChainName}. Restart Hardhat and run npm run deploy:local in blockchain/.`,
        "CONTRACT_NOT_DEPLOYED",
        { contractAddress: config.contractAddress, expectedChainId: config.expectedChainId }
      );
    }
  }

  function chainIdToHex(chainId) {
    return `0x${Number(chainId).toString(16).toUpperCase()}`;
  }

  function isUnknownChainError(error) {
    return error?.code === 4902 || error?.data?.originalError?.code === 4902;
  }

  async function switchToExpectedChain() {
    const ethereum = requireMetaMask();
    const config = await loadConfig();
    const chainId = chainIdToHex(config.expectedChainId);

    async function switchChain() {
      return ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }]
      });
    }

    try {
      await switchChain();
    } catch (error) {
      if (!isUnknownChainError(error)) {
        throw error;
      }

      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId,
            chainName: config.expectedChainName,
            rpcUrls: config.rpcUrls || defaultConfig.rpcUrls,
            nativeCurrency: config.nativeCurrency || defaultConfig.nativeCurrency
          }
        ]
      });
      await switchChain();
    }

    const ethers = requireEthers();
    const provider = new ethers.BrowserProvider(ethereum);
    const actualChainId = await assertExpectedChain(provider, config);
    window.dispatchEvent(new CustomEvent("kryptovault:blockchain-network-changed", {
      detail: { chainId: actualChainId, expectedChainName: config.expectedChainName }
    }));
    return { chainId: actualChainId, config };
  }

  function normalizeSha256Hash(sha256Hash) {
    if (typeof sha256Hash !== "string") {
      throw new BlockchainError("SHA-256 hash must be a hex string.", "INVALID_SHA256_HASH");
    }

    const cleanHash = sha256Hash.startsWith("0x") ? sha256Hash.slice(2) : sha256Hash;
    if (!/^[0-9a-fA-F]{64}$/.test(cleanHash)) {
      throw new BlockchainError("SHA-256 hash must be 32 bytes encoded as 64 hex characters.", "INVALID_SHA256_HASH");
    }

    return `0x${cleanHash.toLowerCase()}`;
  }

  function toContractAssetId(assetId) {
    const ethers = requireEthers();
    if (typeof assetId === "bigint") return assetId;
    if (typeof assetId === "number") {
      if (!Number.isSafeInteger(assetId) || assetId < 0) {
        throw new BlockchainError("Numeric asset ID must be a safe non-negative integer.", "INVALID_ASSET_ID");
      }
      return BigInt(assetId);
    }
    if (typeof assetId !== "string" || !assetId.trim()) {
      throw new BlockchainError("Asset ID is required.", "INVALID_ASSET_ID");
    }

    const trimmed = assetId.trim();
    if (/^\d+$/.test(trimmed)) return BigInt(trimmed);

    return BigInt(ethers.keccak256(ethers.toUtf8Bytes(trimmed)));
  }

  function normalizePermission(permission) {
    if (typeof permission === "string") {
      const value = Permission[permission.trim().toUpperCase()];
      if (value === Permission.READ || value === Permission.WRITE) return value;
    }
    if (permission === Permission.READ || permission === Permission.WRITE) return permission;

    throw new BlockchainError("Permission must be READ or WRITE.", "INVALID_PERMISSION");
  }

  function normalizeAddress(address, fieldName) {
    const ethers = requireEthers();
    if (!address || !ethers.isAddress(address)) {
      throw new BlockchainError(`${fieldName} must be a valid wallet address.`, "INVALID_ADDRESS", { fieldName });
    }
    return ethers.getAddress(address);
  }

  function normalizeTimestamp(value, fieldName) {
    const timestamp = Number(value || 0);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new BlockchainError(`${fieldName} must be a non-negative Unix timestamp.`, "INVALID_TIMESTAMP", { fieldName });
    }
    return timestamp;
  }

  async function connectProvider() {
    const ethers = requireEthers();
    const ethereum = requireMetaMask();
    const config = await loadConfig();
    const provider = new ethers.BrowserProvider(ethereum);

    await provider.send("eth_requestAccounts", []);
    const chainId = await assertExpectedChain(provider, config);
    await assertContractDeployed(provider, config);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    const contract = new ethers.Contract(config.contractAddress, config.abi, signer);

    return { provider, signer, contract, address, chainId, config };
  }

  async function connectReadProvider() {
    const ethers = requireEthers();
    const ethereum = requireMetaMask();
    const config = await loadConfig();
    const provider = new ethers.BrowserProvider(ethereum);
    const chainId = await assertExpectedChain(provider, config);
    await assertContractDeployed(provider, config);
    return { provider, chainId, config };
  }

  async function registerAsset(assetId, sha256Hash) {
    const { contract } = await connectProvider();
    return contract.registerAsset(toContractAssetId(assetId), normalizeSha256Hash(sha256Hash));
  }

  async function grantAccess(assetId, grantee, permission, validFrom = 0, validUntil = 0) {
    const { contract } = await connectProvider();
    return contract.grantAccess(
      toContractAssetId(assetId),
      normalizeAddress(grantee, "grantee"),
      normalizePermission(permission),
      normalizeTimestamp(validFrom, "validFrom"),
      normalizeTimestamp(validUntil, "validUntil")
    );
  }

  async function revokeAccess(assetId, grantee) {
    const { contract } = await connectProvider();
    return contract.revokeAccess(toContractAssetId(assetId), normalizeAddress(grantee, "grantee"));
  }

  async function commitVersion(assetId, sha256Hash) {
    const { contract } = await connectProvider();
    return contract.commitVersion(toContractAssetId(assetId), normalizeSha256Hash(sha256Hash));
  }

  async function getTransactionReceipt(transactionHash) {
    if (typeof transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
      throw new BlockchainError("Transaction hash must be a 32-byte hex string.", "INVALID_TRANSACTION_HASH");
    }
    const { provider } = await connectReadProvider();
    return provider.getTransactionReceipt(transactionHash);
  }

  window.KryptoVaultBlockchain = Object.freeze({
    Permission,
    BlockchainError,
    WrongNetworkError,
    loadConfig,
    connectProvider,
    switchToExpectedChain,
    registerAsset,
    grantAccess,
    revokeAccess,
    commitVersion,
    getTransactionReceipt,
    normalizeSha256Hash,
    toContractAssetId
  });
})();
