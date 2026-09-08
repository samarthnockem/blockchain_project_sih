import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../config/env.js";
import { HttpError } from "../errors/http-error.js";
import { requireAuth } from "../middleware/require-auth.js";
import { AssetModel } from "../models/asset.js";
import { AssetVersionModel } from "../models/asset-version.js";
import { WrappedKeyModel } from "../models/wrapped-key.js";
import { createBlockchainReadService } from "../services/blockchain-read.js";
import { deleteEncryptedAsset, getEncryptedAsset, storeEncryptedAsset } from "../services/encrypted-asset-storage.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.ENCRYPTED_ASSET_MAX_BYTES,
    files: 1,
    fields: 6
  }
});

const sha256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase());
const filenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      value !== "." &&
      value !== ".." &&
      !value.includes("/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      !/[\x00-\x1F\x7F<>:"|?*]/.test(value),
    "Filename must not contain path segments"
  );

const forbiddenSecretFieldNames = new Set([
  "aesKey",
  "rawAESKey",
  "rawAesKey",
  "raw_aes_key",
  "rawKey",
  "secretKey",
  "plaintextFile",
  "fileContents",
  "plaintextFilePassword",
  "filePassword",
  "password",
  "plaintextPassword",
  "passwordDerivedSecretKey",
  "walletPrivateKey",
  "privateKey",
  "privateEncryptionKey",
  "documentEncryptionPrivateKey",
  "mnemonic",
  "passphrase",
  "seedPhrase"
]);

function canonicalFieldName(fieldName: string) {
  return fieldName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

const canonicalForbiddenSecretFieldNames = new Set([...forbiddenSecretFieldNames].map(canonicalFieldName));

function containsForbiddenSecretField(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(containsForbiddenSecretField);
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([key, nestedValue]) =>
      canonicalForbiddenSecretFieldNames.has(canonicalFieldName(key)) || containsForbiddenSecretField(nestedValue)
  );
}

const encryptionMetadataSchema = z
  .string()
  .transform((value, ctx) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Expected JSON object");
      }

      return parsed as Record<string, unknown>;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected JSON object"
      });
      return z.NEVER;
    }
  })
  .refine((value) => !containsForbiddenSecretField(value), "Metadata contains forbidden secret fields")
  .pipe(
    z
      .object({
        algorithm: z.literal("AES-256-GCM"),
        iv: z.string().trim().min(1).max(4096),
        tag: z.string().trim().min(1).max(4096)
      })
      .strict()
  );

const wrappingMetadataSchema = z
  .string()
  .transform((value, ctx) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Expected JSON object");
      }

      return parsed as Record<string, unknown>;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected JSON object"
      });
      return z.NEVER;
    }
  })
  .refine((value) => !containsForbiddenSecretField(value), "Metadata contains forbidden secret fields")
  .pipe(
    z
      .object({
        algorithm: z.literal("RSA-OAEP"),
        keyId: z.string().trim().min(1).max(255)
      })
      .strict()
  );

const uploadBodySchema = z
  .object({
    filename: filenameSchema,
    sha256: sha256Schema,
    wrappedAESKey: z.string().trim().min(1).max(20000),
    encryptionMetadata: encryptionMetadataSchema,
    wrappingMetadata: wrappingMetadataSchema,
    passwordProtectionEnabled: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true")
  })
  .strict();

function singleEncryptedFile(req: Parameters<typeof upload.single>[0]) {
  return upload.single(req);
}

function accessDenied() {
  return new HttpError(403, "ASSET_ACCESS_DENIED", "Asset access denied");
}

function routeParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export const assetsRouter = Router();

assetsRouter.post("/", requireAuth, singleEncryptedFile("encryptedFile"), async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsed = uploadBodySchema.parse(req.body);
    if (!req.file) {
      throw new HttpError(400, "ENCRYPTED_FILE_REQUIRED", "Encrypted file is required");
    }

    if (req.file.mimetype !== "application/octet-stream") {
      throw new HttpError(400, "INVALID_ENCRYPTED_FILE", "Encrypted file must be application/octet-stream");
    }

    const ownerWallet = req.auth.walletAddress.toLowerCase();
    const stored = await storeEncryptedAsset({
      encryptedBytes: req.file.buffer,
      originalFilename: parsed.filename
    });

    try {
      const asset = await AssetModel.create({
        ownerWallet,
        filename: parsed.filename,
        currentVersion: 1,
        sha256: parsed.sha256,
        passwordProtectionEnabled: parsed.passwordProtectionEnabled ?? false
      });

      await AssetVersionModel.create({
        assetId: asset._id,
        version: 1,
        encryptedStorageReference: stored.storageId,
        encryptionMetadata: parsed.encryptionMetadata,
        sha256: parsed.sha256,
        createdBy: ownerWallet,
        commitMessage: "Initial encrypted upload"
      });

      await WrappedKeyModel.create({
        assetId: asset._id,
        userWallet: ownerWallet,
        wrappedAESKey: parsed.wrappedAESKey,
        version: 1,
        wrappingMetadata: parsed.wrappingMetadata,
        active: true
      });

      return res.status(201).json({
        asset: {
          id: asset._id.toString(),
          ownerWallet,
          filename: parsed.filename,
          sha256: parsed.sha256,
          currentVersion: 1,
          status: "active",
          passwordProtectionEnabled: parsed.passwordProtectionEnabled ?? false,
          createdAt: asset.createdAt instanceof Date ? asset.createdAt.toISOString() : undefined,
          updatedAt: asset.updatedAt instanceof Date ? asset.updatedAt.toISOString() : undefined
        }
      });
    } catch (error) {
      await deleteEncryptedAsset(stored.storageId).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

assetsRouter.get("/:assetId/open", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const blockchainAssetId = routeParam(req.params.assetId);
    const walletAddress = req.auth.walletAddress.toLowerCase();
    const blockchain = createBlockchainReadService();

    const permission = await blockchain.getPermission(blockchainAssetId, walletAddress).catch(() => {
      throw accessDenied();
    });

    if (permission === "NONE") {
      throw accessDenied();
    }

    const [currentVersion, currentHash] = await Promise.all([
      blockchain.getCurrentVersion(blockchainAssetId),
      blockchain.getCurrentHash(blockchainAssetId)
    ]).catch(() => {
      throw accessDenied();
    });

    const expectedSha256 = currentHash.startsWith("0x") ? currentHash.slice(2).toLowerCase() : currentHash.toLowerCase();
    const asset = await AssetModel.findOne({ blockchainAssetId }).select("_id filename blockchainAssetId").lean();
    if (!asset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    const assetVersion = await AssetVersionModel.findOne({
      assetId: asset._id,
      version: currentVersion
    })
      .select("encryptedStorageReference encryptionMetadata sha256 version -_id")
      .lean();

    if (!assetVersion) {
      throw new HttpError(404, "ASSET_VERSION_NOT_FOUND", "Asset version not found");
    }

    const wrappedKey = await WrappedKeyModel.findOne({
      assetId: asset._id,
      userWallet: walletAddress,
      version: currentVersion,
      active: true
    })
      .select("wrappedAESKey wrappingMetadata -_id")
      .lean();

    if (!wrappedKey) {
      throw accessDenied();
    }

    const encryptedAsset = await getEncryptedAsset(assetVersion.encryptedStorageReference);
    if (!encryptedAsset) {
      throw new HttpError(404, "ENCRYPTED_ASSET_NOT_FOUND", "Encrypted asset not found");
    }

    return res.json({
      asset: {
        blockchainAssetId,
        filename: asset.filename,
        permission,
        currentVersion,
        expectedSha256,
        encryptionMetadata: assetVersion.encryptionMetadata,
        encryptedFile: {
          contentBase64: encryptedAsset.encryptedBytes.toString("base64"),
          byteLength: encryptedAsset.byteLength
        },
        EK_User: wrappedKey.wrappedAESKey,
        wrappingMetadata: wrappedKey.wrappingMetadata
      }
    });
  } catch (error) {
    return next(error);
  }
});
