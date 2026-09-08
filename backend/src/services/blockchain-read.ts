import { Contract, JsonRpcProvider, getAddress, isAddress, type BigNumberish } from "ethers";
import { env } from "../config/env.js";

export const permissionValues = ["NONE", "READ", "WRITE"] as const;
export type Permission = (typeof permissionValues)[number];

const assetRegistryAbi = [
  "function getAssetOwner(uint256 assetId) view returns (address)",
  "function getPermission(uint256 assetId, address wallet) view returns (uint8)",
  "function getCurrentHash(uint256 assetId) view returns (bytes32)",
  "function getCurrentVersion(uint256 assetId) view returns (uint256)"
] as const;

type BlockchainProvider = {
  getNetwork(): Promise<{
    chainId: bigint;
  }>;
};

type AssetRegistryContract = {
  getAssetOwner(assetId: bigint): Promise<string>;
  getPermission(assetId: bigint, wallet: string): Promise<bigint | number | string>;
  getCurrentHash(assetId: bigint): Promise<string>;
  getCurrentVersion(assetId: bigint): Promise<bigint | number | string>;
};

export type BlockchainReadServiceOptions = {
  provider?: BlockchainProvider;
  contract?: AssetRegistryContract;
  contractAddress?: string;
  chainId?: number;
};

export type BlockchainReadService = {
  getAssetOwner(assetId: BigNumberish): Promise<string>;
  getPermission(assetId: BigNumberish, wallet: string): Promise<Permission>;
  getCurrentHash(assetId: BigNumberish): Promise<string>;
  getCurrentVersion(assetId: BigNumberish): Promise<number>;
};

export class BlockchainVerificationError extends Error {
  readonly code = "BLOCKCHAIN_VERIFICATION_FAILED";

  constructor(message = "Blockchain verification failed") {
    super(message);
    this.name = "BlockchainVerificationError";
  }
}

function normalizeAssetId(assetId: BigNumberish) {
  try {
    const normalized = BigInt(assetId);
    if (normalized < 0n) {
      throw new Error("negative asset id");
    }

    return normalized;
  } catch {
    throw new BlockchainVerificationError();
  }
}

function normalizeWallet(wallet: string) {
  if (!isAddress(wallet)) {
    throw new BlockchainVerificationError();
  }

  return getAddress(wallet);
}

function normalizeHash(hash: string) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
    throw new BlockchainVerificationError();
  }

  return hash.toLowerCase();
}

function normalizePermission(permission: bigint | number | string): Permission {
  if (typeof permission === "string") {
    const upper = permission.toUpperCase();
    if (permissionValues.includes(upper as Permission)) {
      return upper as Permission;
    }
  }

  const numeric = Number(permission);
  if (numeric === 0) {
    return "NONE";
  }

  if (numeric === 1) {
    return "READ";
  }

  if (numeric === 2) {
    return "WRITE";
  }

  throw new BlockchainVerificationError();
}

function normalizeVersion(version: bigint | number | string) {
  try {
    const normalized = BigInt(version);
    if (normalized < 0n || normalized > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("invalid version");
    }

    return Number(normalized);
  } catch {
    throw new BlockchainVerificationError();
  }
}

async function assertExpectedChain(provider: BlockchainProvider, expectedChainId: number) {
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(expectedChainId)) {
    throw new BlockchainVerificationError();
  }
}

function createDefaultProvider(): BlockchainProvider {
  return new JsonRpcProvider(env.BLOCKCHAIN_RPC_URL, env.CHAIN_ID);
}

function createDefaultContract(provider: BlockchainProvider): AssetRegistryContract {
  return new Contract(env.CONTRACT_ADDRESS, assetRegistryAbi, provider as never) as unknown as AssetRegistryContract;
}

async function verifiedCall<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof BlockchainVerificationError) {
      throw error;
    }

    throw new BlockchainVerificationError();
  }
}

export function createBlockchainReadService(options: BlockchainReadServiceOptions = {}): BlockchainReadService {
  const provider = options.provider ?? createDefaultProvider();
  const contractAddress = options.contractAddress ?? env.CONTRACT_ADDRESS;
  const chainId = options.chainId ?? env.CHAIN_ID;

  if (!isAddress(contractAddress)) {
    throw new BlockchainVerificationError();
  }

  const contract = options.contract ?? createDefaultContract(provider);

  return {
    async getAssetOwner(assetId: BigNumberish) {
      return verifiedCall(async () => {
        await assertExpectedChain(provider, chainId);
        const owner = await contract.getAssetOwner(normalizeAssetId(assetId));
        return normalizeWallet(owner).toLowerCase();
      });
    },

    async getPermission(assetId: BigNumberish, wallet: string) {
      return verifiedCall(async () => {
        await assertExpectedChain(provider, chainId);
        const permission = await contract.getPermission(normalizeAssetId(assetId), normalizeWallet(wallet));
        return normalizePermission(permission);
      });
    },

    async getCurrentHash(assetId: BigNumberish) {
      return verifiedCall(async () => {
        await assertExpectedChain(provider, chainId);
        const hash = await contract.getCurrentHash(normalizeAssetId(assetId));
        return normalizeHash(hash);
      });
    },

    async getCurrentVersion(assetId: BigNumberish) {
      return verifiedCall(async () => {
        await assertExpectedChain(provider, chainId);
        const version = await contract.getCurrentVersion(normalizeAssetId(assetId));
        return normalizeVersion(version);
      });
    }
  };
}

export const blockchainReadService = createBlockchainReadService;
