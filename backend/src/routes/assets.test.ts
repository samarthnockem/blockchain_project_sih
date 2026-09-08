import mongoose from "mongoose";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSessionCookie, clearSessionsForTests, createSession } from "../auth/session.js";
import { createApp } from "../app.js";
import { AssetModel } from "../models/asset.js";
import { AssetVersionModel } from "../models/asset-version.js";
import { WrappedKeyModel } from "../models/wrapped-key.js";
import * as blockchainRead from "../services/blockchain-read.js";
import * as encryptedAssetStorage from "../services/encrypted-asset-storage.js";

const ownerWallet = "0x1111111111111111111111111111111111111111";
const spoofedWallet = "0x2222222222222222222222222222222222222222";
const aliceWallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const bobWallet = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const validSha256 = "a".repeat(64);
const currentHash = `0x${"b".repeat(64)}`;
const storageId = "enc_asset_11111111-1111-4111-8111-111111111111";

afterEach(() => {
  clearSessionsForTests();
  vi.restoreAllMocks();
});

function authenticatedCookie(walletAddress = ownerWallet) {
  return buildSessionCookie(createSession(walletAddress));
}

function validUploadRequest() {
  return request(createApp())
    .post("/api/assets")
    .set("Cookie", authenticatedCookie())
    .field("filename", "vault-document.pdf.enc")
    .field("sha256", validSha256)
    .field("wrappedAESKey", "wrapped-key-for-owner")
    .field(
      "encryptionMetadata",
      JSON.stringify({
        algorithm: "AES-256-GCM",
        iv: "base64-iv",
        tag: "base64-tag"
      })
    )
    .field(
      "wrappingMetadata",
      JSON.stringify({
        algorithm: "RSA-OAEP",
        keyId: "owner-key-1"
      })
    )
    .attach("encryptedFile", Buffer.from("encrypted-bytes"), {
      filename: "vault-document.pdf.enc",
      contentType: "application/octet-stream"
    });
}

function mockSuccessfulPersistence() {
  const assetId = new mongoose.Types.ObjectId();

  const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset").mockResolvedValue({
    storageId: "enc_asset_11111111-1111-4111-8111-111111111111",
    byteLength: 15,
    originalFilename: "vault-document.pdf.enc"
  });
  const assetCreateSpy = vi.spyOn(AssetModel, "create").mockResolvedValue({
    _id: assetId,
    createdAt: new Date("2026-09-08T00:00:00.000Z"),
    updatedAt: new Date("2026-09-08T00:00:00.000Z")
  } as never);
  const versionCreateSpy = vi.spyOn(AssetVersionModel, "create").mockResolvedValue({} as never);
  const wrappedKeyCreateSpy = vi.spyOn(WrappedKeyModel, "create").mockResolvedValue({} as never);

  return {
    assetId,
    storeSpy,
    assetCreateSpy,
    versionCreateSpy,
    wrappedKeyCreateSpy
  };
}

function queryResult<T>(value: T) {
  return {
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(value)
    })
  };
}

function mockBlockchainPermission(permission: "NONE" | "READ" | "WRITE", currentVersion = 2) {
  return vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
    getAssetOwner: vi.fn(),
    getPermission: vi.fn().mockResolvedValue(permission),
    getCurrentHash: vi.fn().mockResolvedValue(currentHash),
    getCurrentVersion: vi.fn().mockResolvedValue(currentVersion)
  });
}

function mockOpenRoutePersistence(options: {
  wallet?: string;
  currentVersion?: number;
  wrappedKey?: string | null;
  assetId?: mongoose.Types.ObjectId;
} = {}) {
  const assetId = options.assetId ?? new mongoose.Types.ObjectId();
  const currentVersion = options.currentVersion ?? 2;
  const wallet = options.wallet ?? aliceWallet;
  const wrappedKey = options.wrappedKey === undefined ? "wrapped-key-for-current-user" : options.wrappedKey;

  const assetFindSpy = vi.spyOn(AssetModel, "findOne").mockReturnValue(
    queryResult({
      _id: assetId,
      filename: "vault-document.pdf.enc",
      blockchainAssetId: "123"
    }) as never
  );
  const versionFindSpy = vi.spyOn(AssetVersionModel, "findOne").mockReturnValue(
    queryResult({
      encryptedStorageReference: storageId,
      encryptionMetadata: {
        algorithm: "AES-256-GCM",
        iv: "base64-iv",
        tag: "base64-tag"
      },
      sha256: "b".repeat(64),
      version: currentVersion
    }) as never
  );
  const wrappedKeyFindSpy = vi.spyOn(WrappedKeyModel, "findOne").mockReturnValue(
    queryResult(
      wrappedKey
        ? {
            userWallet: wallet,
            wrappedAESKey: wrappedKey,
            wrappingMetadata: {
              algorithm: "RSA-OAEP",
              keyId: "user-key-1"
            }
          }
        : null
    ) as never
  );
  const encryptedAssetSpy = vi.spyOn(encryptedAssetStorage, "getEncryptedAsset").mockResolvedValue({
    storageId,
    byteLength: Buffer.from("encrypted-bytes").byteLength,
    encryptedBytes: Buffer.from("encrypted-bytes")
  });

  return {
    assetId,
    assetFindSpy,
    versionFindSpy,
    wrappedKeyFindSpy,
    encryptedAssetSpy
  };
}

describe("encrypted asset upload route", () => {
  it("requires authentication", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");

    const response = await request(createApp())
      .post("/api/assets")
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(401);

    expect(response.body.error).toEqual({
      code: "AUTH_REQUIRED",
      message: "Authentication required"
    });
    expect(storeSpy).not.toHaveBeenCalled();
  });

  it("creates asset metadata, version storage reference, and owner wrapped key", async () => {
    const { assetId, storeSpy, assetCreateSpy, versionCreateSpy, wrappedKeyCreateSpy } = mockSuccessfulPersistence();

    const response = await validUploadRequest().expect(201);

    expect(response.body).toEqual({
      asset: {
        id: assetId.toString(),
        ownerWallet,
        filename: "vault-document.pdf.enc",
        sha256: validSha256,
        currentVersion: 1,
        status: "active",
        passwordProtectionEnabled: false,
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z"
      }
    });
    expect(response.body.asset).not.toHaveProperty("encryptedStorageReference");
    expect(response.body.asset).not.toHaveProperty("wrappedAESKey");

    expect(storeSpy).toHaveBeenCalledWith({
      encryptedBytes: Buffer.from("encrypted-bytes"),
      originalFilename: "vault-document.pdf.enc"
    });
    expect(assetCreateSpy).toHaveBeenCalledWith({
      ownerWallet,
      filename: "vault-document.pdf.enc",
      currentVersion: 1,
      sha256: validSha256,
      passwordProtectionEnabled: false
    });
    expect(versionCreateSpy).toHaveBeenCalledWith({
      assetId,
      version: 1,
      encryptedStorageReference: "enc_asset_11111111-1111-4111-8111-111111111111",
      encryptionMetadata: {
        algorithm: "AES-256-GCM",
        iv: "base64-iv",
        tag: "base64-tag"
      },
      sha256: validSha256,
      createdBy: ownerWallet,
      commitMessage: "Initial encrypted upload"
    });
    expect(wrappedKeyCreateSpy).toHaveBeenCalledWith({
      assetId,
      userWallet: ownerWallet,
      wrappedAESKey: "wrapped-key-for-owner",
      version: 1,
      wrappingMetadata: {
        algorithm: "RSA-OAEP",
        keyId: "owner-key-1"
      },
      active: true
    });
  });

  it("rejects oversized uploads before storage", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");

    const response = await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM" }))
      .attach("encryptedFile", Buffer.from("x".repeat(17)), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(413);

    expect(response.body.error.code).toBe("ENCRYPTED_ASSET_TOO_LARGE");
    expect(storeSpy).not.toHaveBeenCalled();
  });

  it("rejects malicious filenames", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");

    const response = await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "../secret.txt")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "safe-name.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(storeSpy).not.toHaveBeenCalled();
  });

  it("rejects forbidden secret fields", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");

    const topLevelSecret = await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("rawAESKey", "must-not-be-accepted")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    const nestedSecret = await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM", aesKey: "raw-secret" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    expect(topLevelSecret.body.error.code).toBe("VALIDATION_ERROR");
    expect(nestedSecret.body.error.code).toBe("VALIDATION_ERROR");
    expect(storeSpy).not.toHaveBeenCalled();
  });

  it("rejects forbidden secret field aliases in upload metadata", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");

    await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM", iv: "iv", tag: "tag", private_key: "x" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM", iv: "iv", tag: "tag" }))
      .field("wrappingMetadata", JSON.stringify({ algorithm: "RSA-OAEP", keyId: "owner-key-1", secret_key: "x" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    expect(storeSpy).not.toHaveBeenCalled();
  });

  it("rejects wrapped AES key uploads without owner key-wrapping metadata", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");
    const wrappedKeyCreateSpy = vi.spyOn(WrappedKeyModel, "create");

    const response = await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "candidate-raw-or-wrapped-key")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM", iv: "iv", tag: "tag" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(storeSpy).not.toHaveBeenCalled();
    expect(wrappedKeyCreateSpy).not.toHaveBeenCalled();
  });

  it("requires declared AES-256-GCM metadata and opaque encrypted bytes", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");

    await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-128-CBC", iv: "iv", tag: "tag" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie())
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM", iv: "iv", tag: "tag" }))
      .attach("encryptedFile", Buffer.from("plaintext"), {
        filename: "vault-document.pdf.enc",
        contentType: "text/plain"
      })
      .expect(400);

    expect(storeSpy).not.toHaveBeenCalled();
  });

  it("rejects owner spoofing and uses the authenticated wallet as owner", async () => {
    const storeSpy = vi.spyOn(encryptedAssetStorage, "storeEncryptedAsset");
    const assetCreateSpy = vi.spyOn(AssetModel, "create");

    const response = await request(createApp())
      .post("/api/assets")
      .set("Cookie", authenticatedCookie(ownerWallet))
      .field("filename", "vault-document.pdf.enc")
      .field("sha256", validSha256)
      .field("wrappedAESKey", "wrapped-key-for-owner")
      .field("ownerWallet", spoofedWallet)
      .field("encryptionMetadata", JSON.stringify({ algorithm: "AES-256-GCM" }))
      .attach("encryptedFile", Buffer.from("encrypted"), {
        filename: "vault-document.pdf.enc",
        contentType: "application/octet-stream"
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(storeSpy).not.toHaveBeenCalled();
    expect(assetCreateSpy).not.toHaveBeenCalled();
  });
});

describe("encrypted asset open route", () => {
  it("denies Alice attempting to open a Bob-only asset", async () => {
    mockBlockchainPermission("READ");
    const { assetId, wrappedKeyFindSpy, encryptedAssetSpy } = mockOpenRoutePersistence({
      wallet: bobWallet,
      wrappedKey: null
    });

    const response = await request(createApp())
      .get("/api/assets/123/open")
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(403);

    expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
    expect(wrappedKeyFindSpy).toHaveBeenCalledWith({
      assetId,
      userWallet: aliceWallet,
      version: 2,
      active: true
    });
    expect(encryptedAssetSpy).not.toHaveBeenCalled();
  });

  it("denies access when a user changes assetId manually to an unauthorized blockchain asset", async () => {
    mockBlockchainPermission("NONE");
    const assetFindSpy = vi.spyOn(AssetModel, "findOne");
    const wrappedKeyFindSpy = vi.spyOn(WrappedKeyModel, "findOne");

    const response = await request(createApp())
      .get("/api/assets/999/open")
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(403);

    expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
    expect(assetFindSpy).not.toHaveBeenCalled();
    expect(wrappedKeyFindSpy).not.toHaveBeenCalled();
  });

  it("denies NONE permission", async () => {
    mockBlockchainPermission("NONE");

    const response = await request(createApp())
      .get("/api/assets/123/open")
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(403);

    expect(response.body.error).toEqual({
      code: "ASSET_ACCESS_DENIED",
      message: "Asset access denied"
    });
  });

  it("opens an encrypted asset with READ permission", async () => {
    const blockchainSpy = mockBlockchainPermission("READ");
    mockOpenRoutePersistence();

    const response = await request(createApp())
      .get("/api/assets/123/open")
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(200);

    expect(response.body.asset).toEqual({
      blockchainAssetId: "123",
      filename: "vault-document.pdf.enc",
      permission: "READ",
      currentVersion: 2,
      expectedSha256: "b".repeat(64),
      encryptionMetadata: {
        algorithm: "AES-256-GCM",
        iv: "base64-iv",
        tag: "base64-tag"
      },
      encryptedFile: {
        contentBase64: Buffer.from("encrypted-bytes").toString("base64"),
        byteLength: Buffer.from("encrypted-bytes").byteLength
      },
      EK_User: "wrapped-key-for-current-user",
      wrappingMetadata: {
        algorithm: "RSA-OAEP",
        keyId: "user-key-1"
      }
    });
    expect(blockchainSpy.mock.results[0].value.getPermission).toHaveBeenCalledWith("123", aliceWallet);
  });

  it("opens an encrypted asset with WRITE permission", async () => {
    mockBlockchainPermission("WRITE");
    mockOpenRoutePersistence();

    const response = await request(createApp())
      .get("/api/assets/123/open")
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(200);

    expect(response.body.asset.permission).toBe("WRITE");
    expect(response.body.asset.EK_User).toBe("wrapped-key-for-current-user");
  });

  it("denies access when the authenticated wallet has no wrapped key", async () => {
    mockBlockchainPermission("READ");
    const { encryptedAssetSpy } = mockOpenRoutePersistence({ wrappedKey: null });

    const response = await request(createApp())
      .get("/api/assets/123/open")
      .set("Cookie", authenticatedCookie(aliceWallet))
      .expect(403);

    expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
    expect(encryptedAssetSpy).not.toHaveBeenCalled();
  });
});
