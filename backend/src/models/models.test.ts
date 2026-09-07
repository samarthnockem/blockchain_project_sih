import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { AssetModel } from "./asset.js";
import { AssetVersionModel } from "./asset-version.js";
import { forbiddenSensitiveFields } from "./schema-guards.js";
import { UserModel } from "./user.js";
import { WrappedKeyModel } from "./wrapped-key.js";

const validWallet = "0x1111111111111111111111111111111111111111";
const validSha256 = "a".repeat(64);
const validObjectId = new mongoose.Types.ObjectId();

const modelsToCheck = [UserModel, AssetModel, WrappedKeyModel, AssetVersionModel];

describe("Secure Vault models", () => {
  it("does not define forbidden sensitive fields", () => {
    for (const model of modelsToCheck) {
      for (const field of forbiddenSensitiveFields) {
        expect(model.schema.path(field), `${model.modelName}.${field}`).toBeUndefined();
      }
    }
  });

  it("uses strict schemas that reject unknown fields", () => {
    for (const model of modelsToCheck) {
      expect(model.schema.get("strict")).toBe("throw");
    }
  });

  it("validates User required fields and wallet format", async () => {
    const user = new UserModel({
      walletAddress: validWallet.toUpperCase(),
      publicEncryptionKey: "user-public-key"
    });

    await expect(user.validate()).resolves.toBeUndefined();
    expect(user.walletAddress).toBe(validWallet);

    await expect(
      new UserModel({
        walletAddress: "not-a-wallet",
        publicEncryptionKey: "user-public-key"
      }).validate()
    ).rejects.toThrow();
  });

  it("validates Asset metadata without plaintext file content fields", async () => {
    const asset = new AssetModel({
      ownerWallet: validWallet,
      filename: "encrypted-document.bin",
      sha256: validSha256,
      passwordProtectionEnabled: false
    });

    await expect(asset.validate()).resolves.toBeUndefined();
    expect(AssetModel.schema.path("plaintextFile")).toBeUndefined();
    expect(AssetModel.schema.path("fileContents")).toBeUndefined();
  });

  it("validates WrappedKey as wrapped key material only", async () => {
    const wrappedKey = new WrappedKeyModel({
      assetId: validObjectId,
      userWallet: validWallet,
      wrappedAESKey: "encrypted-key-for-user",
      version: 1,
      wrappingMetadata: {
        algorithm: "RSA-OAEP",
        keyId: "user-key-1"
      }
    });

    await expect(wrappedKey.validate()).resolves.toBeUndefined();
    expect(WrappedKeyModel.schema.path("aesKey")).toBeUndefined();
    expect(WrappedKeyModel.schema.path("rawKey")).toBeUndefined();
  });

  it("validates AssetVersion encrypted storage references", async () => {
    const assetVersion = new AssetVersionModel({
      assetId: validObjectId,
      version: 1,
      encryptedStorageReference: "storage://encrypted/document-v1",
      sha256: validSha256,
      createdBy: validWallet,
      commitMessage: "Initial encrypted version",
      blockchainTransactionHash: `0x${"b".repeat(64)}`
    });

    await expect(assetVersion.validate()).resolves.toBeUndefined();
  });

  it("defines expected indexes", () => {
    expect(UserModel.schema.indexes()).toContainEqual([{ walletAddress: 1 }, { unique: true }]);
    expect(AssetModel.schema.indexes()).toContainEqual([{ ownerWallet: 1, status: 1 }, {}]);
    expect(WrappedKeyModel.schema.indexes()).toContainEqual([
      { assetId: 1, userWallet: 1, version: 1 },
      { unique: true }
    ]);
    expect(AssetVersionModel.schema.indexes()).toContainEqual([
      { assetId: 1, version: 1 },
      { unique: true }
    ]);
  });
});
