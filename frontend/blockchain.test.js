const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const blockchainSource = fs.readFileSync(path.join(__dirname, "blockchain.js"), "utf8");

assert(blockchainSource.includes("wallet_switchEthereumChain"), "blockchain helper must switch MetaMask networks");
assert(blockchainSource.includes("wallet_addEthereumChain"), "blockchain helper must add unknown local networks");
assert(blockchainSource.includes("expectedChainId: 31337"), "local Hardhat chain ID must remain 31337");
assert(blockchainSource.includes("http://127.0.0.1:8545"), "Hardhat local RPC URL must be configured");

function createContext({ unknownChainOnce = false, contractCode = "0x60016001", initialChainId = "0x1" } = {}) {
  const calls = [];
  let chainId = initialChainId;
  let switchAttempts = 0;

  const ethereum = {
    async request(payload) {
      calls.push(payload);

      if (payload.method === "wallet_switchEthereumChain") {
        switchAttempts += 1;
        if (unknownChainOnce && switchAttempts === 1) {
          const error = new Error("Unknown chain");
          error.code = 4902;
          throw error;
        }
        chainId = payload.params[0].chainId;
        return null;
      }

      if (payload.method === "wallet_addEthereumChain") {
        return null;
      }

      throw new Error(`Unexpected request ${payload.method}`);
    }
  };

  const context = {
    window: {
      ethereum,
      dispatchEvent() {}
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        chainId: 31337,
        network: "Hardhat Local",
        contractAddress: "0x1111111111111111111111111111111111111111",
        abi: [{ type: "function", name: "registerAsset" }]
      })
    }),
    CustomEvent: function CustomEvent(type, options) {
      return { type, ...(options || {}) };
    },
    Error,
    Number,
    BigInt,
    Array,
    Object,
    String,
    RegExp,
    Promise
  };

  context.window.ethers = {
    isAddress: (value) => /^0x[a-fA-F0-9]{40}$/.test(value),
    BrowserProvider: class BrowserProvider {
      constructor() {}
      async getNetwork() {
        return { chainId: BigInt(chainId) };
      }
      async getCode() {
        return contractCode;
      }
      async getTransactionReceipt() {
        return null;
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(blockchainSource, context);
  return { context, calls };
}

async function run() {
  {
    const { context, calls } = createContext();
    const result = await context.window.KryptoVaultBlockchain.switchToExpectedChain();
    assert.equal(result.chainId, 31337);
    assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(calls[0]), JSON.stringify({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x7A69" }]
    }));
  }

  {
    const { context, calls } = createContext({ unknownChainOnce: true });
    const result = await context.window.KryptoVaultBlockchain.switchToExpectedChain();
    assert.equal(result.chainId, 31337);
    assert.equal(calls[0].method, "wallet_switchEthereumChain");
    assert.equal(calls[0].params[0].chainId, "0x7A69");
    assert.equal(calls[1].method, "wallet_addEthereumChain");
    assert.equal(JSON.stringify(calls[1].params[0]), JSON.stringify({
      chainId: "0x7A69",
      chainName: "Hardhat Local",
      rpcUrls: ["http://127.0.0.1:8545"],
      nativeCurrency: {
        name: "ETH",
        symbol: "ETH",
        decimals: 18
      }
    }));
    assert.equal(calls[2].method, "wallet_switchEthereumChain");
    assert.equal(calls[2].params[0].chainId, "0x7A69");
  }

  {
    const { context } = createContext({ contractCode: "0x", initialChainId: "0x7A69" });
    await assert.rejects(
      () => context.window.KryptoVaultBlockchain.getTransactionReceipt(`0x${"1".repeat(64)}`),
      /KryptoVault contract is not deployed/
    );
  }

  console.log("frontend blockchain tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
