import { describe, expect, it, vi } from "vitest";
import { BlockchainVerificationError, createBlockchainReadService } from "./blockchain-read.js";

const ownerWallet = "0x1111111111111111111111111111111111111111";
const readerWallet = "0x2222222222222222222222222222222222222222";
const validHash = `0x${"a".repeat(64)}`;

function fakeProvider(chainId = 31337n) {
  return {
    getNetwork: vi.fn().mockResolvedValue({ chainId })
  };
}

function fakeContract(overrides: Partial<ReturnType<typeof defaultFakeContract>> = {}) {
  return {
    ...defaultFakeContract(),
    ...overrides
  };
}

function defaultFakeContract() {
  return {
    getAssetOwner: vi.fn().mockResolvedValue(ownerWallet),
    getPermission: vi.fn().mockResolvedValue(1n),
    getCurrentHash: vi.fn().mockResolvedValue(validHash),
    getCurrentVersion: vi.fn().mockResolvedValue(3n)
  };
}

describe("blockchain read service", () => {
  it("reads owner from the configured read-only contract", async () => {
    const provider = fakeProvider();
    const contract = fakeContract();
    const service = createBlockchainReadService({ provider, contract, chainId: 31337 });

    await expect(service.getAssetOwner(12)).resolves.toBe(ownerWallet);

    expect(provider.getNetwork).toHaveBeenCalledOnce();
    expect(contract.getAssetOwner).toHaveBeenCalledWith(12n);
  });

  it("normalizes permissions to NONE READ WRITE", async () => {
    const provider = fakeProvider();
    const contract = fakeContract({
      getPermission: vi.fn().mockResolvedValueOnce(0n).mockResolvedValueOnce(1n).mockResolvedValueOnce(2n)
    });
    const service = createBlockchainReadService({ provider, contract, chainId: 31337 });

    await expect(service.getPermission(1, readerWallet)).resolves.toBe("NONE");
    await expect(service.getPermission(1, readerWallet)).resolves.toBe("READ");
    await expect(service.getPermission(1, readerWallet)).resolves.toBe("WRITE");

    expect(contract.getPermission).toHaveBeenCalledWith(1n, "0x2222222222222222222222222222222222222222");
  });

  it("reads current hash and version", async () => {
    const provider = fakeProvider();
    const contract = fakeContract();
    const service = createBlockchainReadService({ provider, contract, chainId: 31337 });

    await expect(service.getCurrentHash("7")).resolves.toBe(validHash);
    await expect(service.getCurrentVersion(7n)).resolves.toBe(3);

    expect(contract.getCurrentHash).toHaveBeenCalledWith(7n);
    expect(contract.getCurrentVersion).toHaveBeenCalledWith(7n);
  });

  it("fails closed when the provider is on the wrong chain", async () => {
    const provider = fakeProvider(11155111n);
    const contract = fakeContract();
    const service = createBlockchainReadService({ provider, contract, chainId: 31337 });

    await expect(service.getAssetOwner(1)).rejects.toBeInstanceOf(BlockchainVerificationError);
    expect(contract.getAssetOwner).not.toHaveBeenCalled();
  });

  it("fails closed when blockchain reads fail", async () => {
    const provider = fakeProvider();
    const contract = fakeContract({
      getCurrentVersion: vi.fn().mockRejectedValue(new Error("rpc unavailable"))
    });
    const service = createBlockchainReadService({ provider, contract, chainId: 31337 });

    await expect(service.getCurrentVersion(1)).rejects.toMatchObject({
      code: "BLOCKCHAIN_VERIFICATION_FAILED"
    });
  });

  it("fails closed for invalid wallet, hash, permission, version, and asset id values", async () => {
    const provider = fakeProvider();

    await expect(
      createBlockchainReadService({
        provider,
        contract: fakeContract({ getAssetOwner: vi.fn().mockResolvedValue("not-a-wallet") }),
        chainId: 31337
      }).getAssetOwner(1)
    ).rejects.toBeInstanceOf(BlockchainVerificationError);

    await expect(
      createBlockchainReadService({
        provider,
        contract: fakeContract({ getCurrentHash: vi.fn().mockResolvedValue("not-a-hash") }),
        chainId: 31337
      }).getCurrentHash(1)
    ).rejects.toBeInstanceOf(BlockchainVerificationError);

    await expect(
      createBlockchainReadService({
        provider,
        contract: fakeContract({ getPermission: vi.fn().mockResolvedValue(99n) }),
        chainId: 31337
      }).getPermission(1, readerWallet)
    ).rejects.toBeInstanceOf(BlockchainVerificationError);

    await expect(
      createBlockchainReadService({
        provider,
        contract: fakeContract({ getCurrentVersion: vi.fn().mockResolvedValue(-1n) }),
        chainId: 31337
      }).getCurrentVersion(1)
    ).rejects.toBeInstanceOf(BlockchainVerificationError);

    await expect(
      createBlockchainReadService({
        provider,
        contract: fakeContract(),
        chainId: 31337
      }).getPermission(-1, readerWallet)
    ).rejects.toBeInstanceOf(BlockchainVerificationError);
  });
});
