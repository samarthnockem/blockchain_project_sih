import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../config/env.js";
import { HttpError } from "../errors/http-error.js";
import { requireAuth } from "../middleware/require-auth.js";
import { AssetAuditEventModel } from "../models/asset-audit-event.js";
import { AssetModel } from "../models/asset.js";
import { AssetVersionModel } from "../models/asset-version.js";
import { AccessGrantModel } from "../models/access-grant.js";
import { FolderModel } from "../models/folder.js";
import { UserModel } from "../models/user.js";
import { WrappedKeyModel } from "../models/wrapped-key.js";
import { BlockchainVerificationError, createBlockchainReadService } from "../services/blockchain-read.js";
import { deleteEncryptedAsset, getEncryptedAsset, storeEncryptedAsset } from "../services/encrypted-asset-storage.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.ENCRYPTED_ASSET_MAX_BYTES,
    files: 1,
    fields: 9
  }
});

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/);
const sha256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase());
const originalSizeSchema = z
  .string()
  .regex(/^\d+$/)
  .transform((value) => Number(value))
  .pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER));
const mimeTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\x00-\x1F\x7F]/.test(value), "MIME type must not contain control characters");
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
    z.discriminatedUnion("algorithm", [
      z
        .object({
          algorithm: z.literal("RSA-OAEP"),
          keyId: z.string().trim().min(1).max(255)
        })
        .strict(),
      z
        .object({
          algorithm: z.literal("PBKDF2-SHA-256+A256GCM"),
          kdf: z
            .object({
              algorithm: z.literal("PBKDF2-SHA-256"),
              iterations: z.number().int().min(210000).max(2000000),
              salt: z.string().trim().min(16).max(4096)
            })
            .strict(),
          keyEncryption: z
            .object({
              algorithm: z.literal("AES-256-GCM"),
              iv: z.string().trim().min(16).max(4096)
            })
            .strict()
        })
        .strict()
    ])
  );

const wrappingMetadataObjectSchema = z
  .unknown()
  .refine((value) => !containsForbiddenSecretField(value), "Metadata contains forbidden secret fields")
  .pipe(
    z.discriminatedUnion("algorithm", [
      z
        .object({
          algorithm: z.literal("RSA-OAEP"),
          keyId: z.string().trim().min(1).max(255)
        })
        .strict(),
      z
        .object({
          algorithm: z.literal("PBKDF2-SHA-256+A256GCM"),
          kdf: z
            .object({
              algorithm: z.literal("PBKDF2-SHA-256"),
              iterations: z.number().int().min(210000).max(2000000),
              salt: z.string().trim().min(16).max(4096)
            })
            .strict(),
          keyEncryption: z
            .object({
              algorithm: z.literal("AES-256-GCM"),
              iv: z.string().trim().min(16).max(4096)
            })
            .strict()
        })
        .strict()
    ])
  );

const uploadBodySchema = z
  .object({
    filename: filenameSchema,
    mimeType: mimeTypeSchema,
    originalSize: originalSizeSchema,
    sha256: sha256Schema,
    wrappedAESKey: z.string().trim().min(1).max(20000),
    encryptionMetadata: encryptionMetadataSchema,
    wrappingMetadata: wrappingMetadataSchema,
    passwordProtectionEnabled: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    folderId: objectIdSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const passwordProtected = value.passwordProtectionEnabled === true;
    const passwordWrapped = value.wrappingMetadata.algorithm === "PBKDF2-SHA-256+A256GCM";

    if (passwordProtected !== passwordWrapped) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["wrappingMetadata"],
        message: passwordProtected
          ? "Password-protected uploads must use password wrapping metadata"
          : "Non-password uploads must use owner public-key wrapping metadata"
      });
    }
  });

const moveAssetFolderParamsSchema = z
  .object({
    assetId: objectIdSchema
  })
  .strict();

const blockchainSyncParamsSchema = z
  .object({
    assetId: objectIdSchema
  })
  .strict();

const blockchainSyncBodySchema = z
  .object({
    transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/)
  })
  .strict();

const walletAddressSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((value) => value.toLowerCase());

const accessGrantTimestampSchema = z
  .union([z.number().int(), z.string().trim()])
  .nullish()
  .transform((value, ctx) => {
    if (value === undefined || value === null || value === "") {
      return 0;
    }

    const timestamp = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected a non-negative Unix timestamp"
      });
      return z.NEVER;
    }

    return timestamp;
  });

const grantAccessSyncParamsSchema = z
  .object({
    assetId: objectIdSchema
  })
  .strict();

const grantAccessSyncBodySchema = z
  .object({
    granteeWallet: walletAddressSchema,
    wrappedAESKey: z.string().trim().min(1).max(20000),
    accessType: z.enum(["READ", "WRITE"]),
    validFrom: accessGrantTimestampSchema,
    validUntil: accessGrantTimestampSchema,
    reason: z.string().trim().max(1000).optional(),
    granteeDisplayName: z.string().trim().min(1).max(100).optional(),
    blockchainTransactionHash: z
      .string()
      .trim()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .transform((value) => value.toLowerCase()),
    wrappingMetadata: wrappingMetadataObjectSchema
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.validUntil !== 0 && value.validUntil <= value.validFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validUntil"],
        message: "validUntil must be after validFrom"
      });
    }
  });

const moveAssetFolderBodySchema = z
  .object({
    folderId: objectIdSchema.nullable()
  })
  .strict();

const listAssetsQuerySchema = z
  .object({
    folderId: objectIdSchema.optional()
  })
  .strict();

const myAssetsQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
    folderId: objectIdSchema.optional()
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

function safeAssetFolder(asset: { _id: unknown; ownerWallet: string; filename: string; folderId?: unknown }) {
  return {
    id: asset._id?.toString(),
    ownerWallet: asset.ownerWallet,
    filename: asset.filename,
    folderId: asset.folderId ? asset.folderId.toString() : null
  };
}

function safeAssetSummary(asset: {
  _id: unknown;
  ownerWallet: string;
  filename: string;
  size?: number;
  mimeType?: string;
  sha256: string;
  currentVersion: number;
  status: string;
  passwordProtectionEnabled?: boolean;
  blockchainAssetId?: string;
  folderId?: unknown;
  registrationTransactionHash?: string;
  registrationBlockNumber?: number;
  blockchainVerificationStatus?: string;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: asset._id?.toString(),
    ownerWallet: asset.ownerWallet,
    filename: asset.filename,
    size: typeof asset.size === "number" ? asset.size : 0,
    mimeType: asset.mimeType || "application/octet-stream",
    sha256: asset.sha256,
    currentVersion: asset.currentVersion,
    status: asset.status,
    passwordProtectionEnabled: asset.passwordProtectionEnabled ?? false,
    blockchainAssetId: asset.blockchainAssetId || null,
    folderId: asset.folderId ? asset.folderId.toString() : null,
    registrationTransactionHash: asset.registrationTransactionHash || null,
    registrationBlockNumber: typeof asset.registrationBlockNumber === "number" ? asset.registrationBlockNumber : null,
    blockchainVerificationStatus: asset.blockchainVerificationStatus || "pending",
    createdAt: asset.createdAt instanceof Date ? asset.createdAt.toISOString() : undefined,
    updatedAt: asset.updatedAt instanceof Date ? asset.updatedAt.toISOString() : undefined
  };
}

function safeMyAsset(asset: Parameters<typeof safeAssetSummary>[0]) {
  const summary = safeAssetSummary(asset);
  return {
    assetId: summary.id,
    filename: summary.filename,
    size: summary.size,
    mimeType: summary.mimeType,
    folderId: summary.folderId,
    sha256: summary.sha256,
    currentVersion: summary.currentVersion,
    status: summary.status,
    passwordProtectionEnabled: summary.passwordProtectionEnabled,
    createdAt: summary.createdAt,
    blockchainAssetId: summary.blockchainAssetId,
    registrationTransactionHash: summary.registrationTransactionHash,
    registrationBlockNumber: summary.registrationBlockNumber,
    blockchainVerificationStatus: summary.blockchainVerificationStatus
  };
}

function dateOrNull(value: unknown) {
  return value instanceof Date ? value.toISOString() : null;
}

function isExpired(validUntil: unknown, now: Date) {
  return validUntil instanceof Date && validUntil.getTime() <= now.getTime();
}

function assetVersionKey(assetId: unknown, version: number) {
  return `${assetId?.toString()}:${version}`;
}

async function loadAuthorizedEncryptedAsset(assetId: string, walletAddress: string) {
  const asset = await AssetModel.findOne({
    _id: assetId,
    status: { $in: ["ACTIVE", "active"] }
  })
    .select("_id ownerWallet filename size mimeType blockchainAssetId blockchainVerificationStatus")
    .lean();

  if (!asset || !asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
    throw accessDenied();
  }

  const blockchain = createBlockchainReadService();
  const [permission, currentVersion, currentHash] = await Promise.all([
    blockchain.getPermission(asset.blockchainAssetId, walletAddress),
    blockchain.getCurrentVersion(asset.blockchainAssetId),
    blockchain.getCurrentHash(asset.blockchainAssetId)
  ]).catch(() => {
    throw accessDenied();
  });

  if (permission !== "READ" && permission !== "WRITE") {
    throw accessDenied();
  }

  const sha256 = currentHash.startsWith("0x") ? currentHash.slice(2).toLowerCase() : currentHash.toLowerCase();
  const assetVersion = await AssetVersionModel.findOne({
    assetId: asset._id,
    version: currentVersion,
    sha256
  })
    .select("encryptedStorageReference encryptionMetadata sha256 version -_id")
    .lean();

  if (!assetVersion) {
    throw accessDenied();
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

  return {
    asset,
    assetVersion,
    wrappedKey,
    permission,
    currentVersion,
    sha256
  };
}

async function safeBlockchainAssetDetail(asset: {
  _id: unknown;
  ownerWallet: string;
  filename: string;
  sha256: string;
  currentVersion: number;
  status: string;
  blockchainAssetId?: string | null;
  registrationTransactionHash?: string | null;
  registrationBlockNumber?: number | null;
  blockchainVerificationStatus?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  const applicationAssetId = asset._id?.toString();
  const base = {
    assetId: applicationAssetId,
    filename: asset.filename,
    ownerWallet: asset.ownerWallet,
    blockchainAssetId: asset.blockchainAssetId || null,
    currentHash: asset.sha256 ? `0x${asset.sha256.toLowerCase()}` : "",
    currentVersion: asset.currentVersion,
    registrationTxHash: asset.registrationTransactionHash || null,
    blockNumber: typeof asset.registrationBlockNumber === "number" ? asset.registrationBlockNumber : null,
    status: asset.status,
    blockchainVerificationStatus: asset.blockchainVerificationStatus || "pending",
    createdAt: asset.createdAt instanceof Date ? asset.createdAt.toISOString() : undefined,
    updatedAt: asset.updatedAt instanceof Date ? asset.updatedAt.toISOString() : undefined
  };

  if (!asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
    return base;
  }

  const blockchain = createBlockchainReadService();
  try {
    const [ownerWallet, currentHash, currentVersion] = await Promise.all([
      blockchain.getAssetOwner(asset.blockchainAssetId),
      blockchain.getCurrentHash(asset.blockchainAssetId),
      blockchain.getCurrentVersion(asset.blockchainAssetId)
    ]);

    return {
      ...base,
      ownerWallet,
      currentHash,
      currentVersion,
      status:
        ownerWallet === asset.ownerWallet.toLowerCase() &&
        currentHash === `0x${asset.sha256.toLowerCase()}` &&
        currentVersion === asset.currentVersion
          ? "VERIFIED"
          : "BLOCKCHAIN_MISMATCH",
      blockchainVerificationStatus:
        ownerWallet === asset.ownerWallet.toLowerCase() &&
        currentHash === `0x${asset.sha256.toLowerCase()}` &&
        currentVersion === asset.currentVersion
          ? "verified"
          : "failed"
    };
  } catch {
    return {
      ...base,
      status: "BLOCKCHAIN_VERIFICATION_FAILED",
      blockchainVerificationStatus: "failed"
    };
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const assetsRouter = Router();

assetsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedQuery = listAssetsQuerySchema.parse(req.query);
    const ownerWallet = req.auth.walletAddress.toLowerCase();
    const filter: { ownerWallet: string; status: { $in: string[] }; folderId?: string } = {
      ownerWallet,
      status: { $in: ["ACTIVE", "active"] }
    };

    if (parsedQuery.folderId) {
      const folder = await FolderModel.findOne({ _id: parsedQuery.folderId, ownerWallet }).select("_id").lean();
      if (!folder) {
        throw new HttpError(404, "FOLDER_NOT_FOUND", "Folder not found");
      }
      filter.folderId = parsedQuery.folderId;
    }

    const assets = await AssetModel.find(filter)
      .sort({ createdAt: -1 })
      .select("ownerWallet filename sha256 currentVersion status passwordProtectionEnabled folderId createdAt updatedAt")
      .lean();

    return res.json({
      assets: assets.map(safeAssetSummary)
    });
  } catch (error) {
    return next(error);
  }
});

assetsRouter.get("/my", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedQuery = myAssetsQuerySchema.parse(req.query);
    const ownerWallet = req.auth.walletAddress.toLowerCase();
    const filter: {
      ownerWallet: string;
      folderId?: string;
      filename?: { $regex: string; $options: string };
    } = {
      ownerWallet
    };

    if (parsedQuery.search) {
      filter.filename = {
        $regex: escapeRegex(parsedQuery.search),
        $options: "i"
      };
    }

    if (parsedQuery.folderId) {
      const folder = await FolderModel.findOne({ _id: parsedQuery.folderId, ownerWallet }).select("_id").lean();
      if (!folder) {
        throw new HttpError(404, "FOLDER_NOT_FOUND", "Folder not found");
      }
      filter.folderId = parsedQuery.folderId;
    }

    const assets = await AssetModel.find(filter)
      .sort({ createdAt: -1 })
      .select(
        "ownerWallet filename size mimeType sha256 currentVersion status passwordProtectionEnabled folderId blockchainAssetId registrationTransactionHash registrationBlockNumber blockchainVerificationStatus createdAt"
      )
      .lean();

    return res.json({
      assets: assets.map(safeMyAsset)
    });
  } catch (error) {
    return next(error);
  }
});

assetsRouter.get("/shared-with-me", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const walletAddress = req.auth.walletAddress.toLowerCase();
    const wrappedKeys = await WrappedKeyModel.find({ userWallet: walletAddress, active: true })
      .select("assetId version")
      .lean();

    if (!wrappedKeys.length) {
      return res.json({ assets: [] });
    }

    const allowedAssetVersions = new Set(wrappedKeys.map((key) => assetVersionKey(key.assetId, key.version)));
    const assetIds = [...new Set(wrappedKeys.map((key) => key.assetId?.toString()).filter(Boolean))];
    const assets = await AssetModel.find({
      _id: { $in: assetIds },
      ownerWallet: { $ne: walletAddress },
      status: { $in: ["ACTIVE", "active"] }
    })
      .sort({ createdAt: -1 })
      .select(
        "_id ownerWallet filename size mimeType sha256 currentVersion blockchainAssetId blockchainVerificationStatus"
      )
      .lean();

    const chainRegisteredAssets = assets.filter(
      (asset) =>
        asset.blockchainAssetId &&
        asset.blockchainVerificationStatus === "verified" &&
        allowedAssetVersions.has(assetVersionKey(asset._id, asset.currentVersion))
    );

    if (!chainRegisteredAssets.length) {
      return res.json({ assets: [] });
    }

    const grants = await AccessGrantModel.find({
      assetId: { $in: chainRegisteredAssets.map((asset) => asset._id) },
      granteeWallet: walletAddress,
      status: "ACTIVE"
    })
      .sort({ createdAt: -1 })
      .select("assetId accessType validUntil")
      .lean();
    const now = new Date();

    const grantsByAssetAndPermission = new Map<string, (typeof grants)[number]>();
    for (const grant of grants) {
      if (isExpired(grant.validUntil, now)) continue;
      const key = `${grant.assetId?.toString()}:${grant.accessType}`;
      if (!grantsByAssetAndPermission.has(key)) {
        grantsByAssetAndPermission.set(key, grant);
      }
    }

    const ownerWallets = [...new Set(chainRegisteredAssets.map((asset) => asset.ownerWallet))];
    const owners = await UserModel.find({ walletAddress: { $in: ownerWallets } })
      .select("walletAddress displayName")
      .lean();
    const ownerDisplayNames = new Map(owners.map((owner) => [owner.walletAddress, owner.displayName || null]));

    const blockchain = createBlockchainReadService();
    const sharedAssets = [];
    for (const asset of chainRegisteredAssets) {
      const permission = await blockchain.getPermission(asset.blockchainAssetId, walletAddress);
      if (permission !== "READ" && permission !== "WRITE") {
        continue;
      }

      const grant = grantsByAssetAndPermission.get(`${asset._id?.toString()}:${permission}`);
      if (!grant) {
        continue;
      }

      sharedAssets.push({
        assetId: asset._id?.toString(),
        filename: asset.filename,
        ownerWallet: asset.ownerWallet,
        ownerDisplayName: ownerDisplayNames.get(asset.ownerWallet) || null,
        permission,
        expiry: dateOrNull(grant.validUntil),
        currentVersion: asset.currentVersion,
        sha256: asset.sha256,
        blockchainVerified: true,
        size: typeof asset.size === "number" ? asset.size : 0,
        mimeType: asset.mimeType || "application/octet-stream"
      });
    }

    return res.json({ assets: sharedAssets });
  } catch (error) {
    return next(error);
  }
});

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

    if (parsed.folderId) {
      const folder = await FolderModel.findOne({ _id: parsed.folderId, ownerWallet }).select("_id").lean();
      if (!folder) {
        throw new HttpError(404, "FOLDER_NOT_FOUND", "Folder not found");
      }
    }

    const stored = await storeEncryptedAsset({
      encryptedBytes: req.file.buffer,
      originalFilename: parsed.filename
    });

    try {
      const asset = await AssetModel.create({
        ownerWallet,
        filename: parsed.filename,
        size: parsed.originalSize,
        mimeType: parsed.mimeType,
        currentVersion: 1,
        sha256: parsed.sha256,
        status: "PENDING_BLOCKCHAIN",
        blockchainVerificationStatus: "pending",
        passwordProtectionEnabled: parsed.passwordProtectionEnabled ?? false,
        folderId: parsed.folderId ?? null
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

      await AssetAuditEventModel.create({
        assetId: asset._id,
        ownerWallet,
        actorWallet: ownerWallet,
        eventType: "ASSET_UPLOADED",
        fromFolderId: null,
        toFolderId: parsed.folderId ?? null
      });

      return res.status(201).json({
        asset: {
          id: asset._id.toString(),
          ownerWallet,
          filename: parsed.filename,
          size: parsed.originalSize,
          mimeType: parsed.mimeType,
          sha256: parsed.sha256,
          currentVersion: 1,
          status: "PENDING_BLOCKCHAIN",
          blockchainVerificationStatus: "pending",
          passwordProtectionEnabled: parsed.passwordProtectionEnabled ?? false,
          folderId: parsed.folderId ?? null,
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

assetsRouter.post("/:assetId/blockchain-sync", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = blockchainSyncParamsSchema.parse(req.params);
    const parsedBody = blockchainSyncBodySchema.parse(req.body);
    const ownerWallet = req.auth.walletAddress.toLowerCase();
    const asset = await AssetModel.findOne({ _id: parsedParams.assetId, ownerWallet })
      .select(
        "_id ownerWallet filename size mimeType sha256 currentVersion status passwordProtectionEnabled folderId blockchainAssetId registrationTransactionHash registrationBlockNumber blockchainVerificationStatus createdAt updatedAt"
      )
      .lean();

    if (!asset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    if (asset.status === "ACTIVE" && asset.blockchainVerificationStatus === "verified") {
      throw new HttpError(409, "ASSET_ALREADY_SYNCED", "Asset is already registered on-chain");
    }

    const existingTransaction = await AssetModel.findOne({
      registrationTransactionHash: parsedBody.transactionHash.toLowerCase(),
      _id: { $ne: parsedParams.assetId }
    })
      .select("_id")
      .lean();

    if (existingTransaction) {
      throw new HttpError(409, "BLOCKCHAIN_TRANSACTION_ALREADY_USED", "Blockchain transaction is already linked to another asset");
    }

    const blockchain = createBlockchainReadService();
    const verified = await blockchain.verifyAssetRegistration({
      transactionHash: parsedBody.transactionHash,
      applicationAssetId: parsedParams.assetId,
      expectedOwnerWallet: ownerWallet,
      expectedSha256: asset.sha256
    });

    const updatedAsset = await AssetModel.findOneAndUpdate(
      {
        _id: parsedParams.assetId,
        ownerWallet,
        registrationTransactionHash: { $in: [null, verified.transactionHash] }
      },
      {
        $set: {
          blockchainAssetId: verified.blockchainAssetId,
          registrationTransactionHash: verified.transactionHash,
          registrationBlockNumber: verified.blockNumber,
          status: "ACTIVE",
          blockchainVerificationStatus: "verified"
        }
      },
      {
        new: true,
        runValidators: true
      }
    )
      .select(
        "_id ownerWallet filename size mimeType sha256 currentVersion status passwordProtectionEnabled folderId blockchainAssetId registrationTransactionHash registrationBlockNumber blockchainVerificationStatus createdAt updatedAt"
      )
      .lean();

    if (!updatedAsset) {
      throw new HttpError(409, "BLOCKCHAIN_TRANSACTION_ALREADY_USED", "Blockchain transaction is already linked");
    }

    return res.json({
      asset: safeAssetSummary(updatedAsset)
    });
  } catch (error) {
    if (error instanceof BlockchainVerificationError) {
      return next(new HttpError(400, error.code, error.message));
    }

    return next(error);
  }
});

assetsRouter.get("/:assetId/access", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = grantAccessSyncParamsSchema.parse(req.params);
    const ownerWallet = req.auth.walletAddress.toLowerCase();
    const asset = await AssetModel.findOne({ _id: parsedParams.assetId, ownerWallet })
      .select("_id ownerWallet blockchainAssetId blockchainVerificationStatus")
      .lean();

    if (!asset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    if (!asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
      return res.json({ access: [] });
    }

    const blockchain = createBlockchainReadService();
    const blockchainOwner = await blockchain.getAssetOwner(asset.blockchainAssetId);
    if (blockchainOwner.toLowerCase() !== ownerWallet) {
      throw accessDenied();
    }

    const grants = await AccessGrantModel.find({ assetId: asset._id, ownerWallet })
      .sort({ createdAt: -1 })
      .select("granteeWallet granteeDisplayName accessType validFrom validUntil reason blockchainTxHash status")
      .lean();
    const now = new Date();

    const access = await Promise.all(
      grants.map(async (grant) => {
        const currentPermission = await blockchain.getPermission(asset.blockchainAssetId, grant.granteeWallet);
        const status = isExpired(grant.validUntil, now)
          ? "EXPIRED"
          : currentPermission === grant.accessType && grant.status === "ACTIVE"
            ? "ACTIVE"
            : "REVOKED";

        return {
          granteeWallet: grant.granteeWallet,
          granteeDisplayName: grant.granteeDisplayName || null,
          accessType: grant.accessType,
          validFrom: dateOrNull(grant.validFrom),
          validUntil: dateOrNull(grant.validUntil),
          reason: grant.reason || null,
          status,
          blockchainTxHash: grant.blockchainTxHash
        };
      })
    );

    return res.json({ access });
  } catch (error) {
    if (error instanceof BlockchainVerificationError) {
      return next(new HttpError(400, error.code, error.message));
    }

    return next(error);
  }
});

assetsRouter.post("/:assetId/access/grant-sync", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = grantAccessSyncParamsSchema.parse(req.params);
    const parsedBody = grantAccessSyncBodySchema.parse(req.body);
    const ownerWallet = req.auth.walletAddress.toLowerCase();

    const asset = await AssetModel.findOne({ _id: parsedParams.assetId, ownerWallet })
      .select("_id ownerWallet filename currentVersion blockchainAssetId blockchainVerificationStatus status")
      .lean();

    if (!asset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    if (!asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
      throw new HttpError(409, "ASSET_NOT_REGISTERED_ON_CHAIN", "Asset must be registered on-chain before granting access");
    }

    const existingGrant = await AccessGrantModel.findOne({
      blockchainTxHash: parsedBody.blockchainTransactionHash
    })
      .select("_id")
      .lean();

    if (existingGrant) {
      throw new HttpError(409, "BLOCKCHAIN_TRANSACTION_ALREADY_USED", "Blockchain transaction is already linked to an access grant");
    }

    const blockchain = createBlockchainReadService();
    const blockchainOwner = await blockchain.getAssetOwner(asset.blockchainAssetId);
    if (blockchainOwner.toLowerCase() !== ownerWallet) {
      throw new HttpError(403, "ASSET_ACCESS_DENIED", "Asset owner could not be verified on-chain");
    }

    const verifiedGrant = await blockchain.verifyAccessGrant({
      transactionHash: parsedBody.blockchainTransactionHash,
      blockchainAssetId: asset.blockchainAssetId,
      expectedOwnerWallet: ownerWallet,
      expectedGranteeWallet: parsedBody.granteeWallet,
      expectedAccessType: parsedBody.accessType,
      expectedValidFrom: parsedBody.validFrom,
      expectedValidUntil: parsedBody.validUntil
    });

    const activeGrant = await AccessGrantModel.create({
      assetId: asset._id,
      ownerWallet,
      granteeWallet: verifiedGrant.granteeWallet,
      granteeDisplayName: parsedBody.granteeDisplayName,
      accessType: verifiedGrant.accessType,
      validFrom: verifiedGrant.validFrom ? new Date(verifiedGrant.validFrom * 1000) : undefined,
      validUntil: verifiedGrant.validUntil ? new Date(verifiedGrant.validUntil * 1000) : undefined,
      reason: parsedBody.reason,
      blockchainTxHash: verifiedGrant.transactionHash,
      status: "ACTIVE"
    });

    await WrappedKeyModel.create({
      assetId: asset._id,
      userWallet: verifiedGrant.granteeWallet,
      wrappedAESKey: parsedBody.wrappedAESKey,
      version: asset.currentVersion,
      wrappingMetadata: parsedBody.wrappingMetadata,
      active: true
    });

    await AssetAuditEventModel.create({
      assetId: asset._id,
      ownerWallet,
      actorWallet: ownerWallet,
      eventType: "ASSET_ACCESS_GRANTED",
      fromFolderId: null,
      toFolderId: null
    });

    return res.status(201).json({
      accessGrant: {
        id: activeGrant._id.toString(),
        assetId: asset._id.toString(),
        ownerWallet,
        granteeWallet: verifiedGrant.granteeWallet,
        granteeDisplayName: parsedBody.granteeDisplayName || null,
        accessType: verifiedGrant.accessType,
        validFrom: verifiedGrant.validFrom ? new Date(verifiedGrant.validFrom * 1000).toISOString() : null,
        validUntil: verifiedGrant.validUntil ? new Date(verifiedGrant.validUntil * 1000).toISOString() : null,
        reason: parsedBody.reason || null,
        blockchainTxHash: verifiedGrant.transactionHash,
        blockNumber: verifiedGrant.blockNumber,
        status: "ACTIVE"
      }
    });
  } catch (error) {
    if (error instanceof BlockchainVerificationError) {
      return next(new HttpError(400, error.code, error.message));
    }

    return next(error);
  }
});

assetsRouter.patch("/:assetId/folder", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = moveAssetFolderParamsSchema.parse(req.params);
    const parsedBody = moveAssetFolderBodySchema.parse(req.body);
    const ownerWallet = req.auth.walletAddress.toLowerCase();

    if (parsedBody.folderId !== null) {
      const folder = await FolderModel.findOne({ _id: parsedBody.folderId, ownerWallet }).select("_id").lean();
      if (!folder) {
        throw new HttpError(404, "FOLDER_NOT_FOUND", "Folder not found");
      }
    }

    const asset = await AssetModel.findOne({ _id: parsedParams.assetId, ownerWallet })
      .select("_id ownerWallet filename folderId")
      .lean();

    if (!asset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    const previousFolderId = asset.folderId ?? null;
    const updatedAsset = await AssetModel.findOneAndUpdate(
      { _id: parsedParams.assetId, ownerWallet },
      {
        $set: {
          folderId: parsedBody.folderId
        }
      },
      {
        new: true,
        runValidators: true
      }
    )
      .select("_id ownerWallet filename folderId")
      .lean();

    if (!updatedAsset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    await AssetAuditEventModel.create({
      assetId: updatedAsset._id,
      ownerWallet,
      actorWallet: ownerWallet,
      eventType: "ASSET_FOLDER_MOVED",
      fromFolderId: previousFolderId,
      toFolderId: parsedBody.folderId
    });

    return res.json({
      asset: safeAssetFolder(updatedAsset)
    });
  } catch (error) {
    return next(error);
  }
});

assetsRouter.get("/:assetId/blockchain", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = moveAssetFolderParamsSchema.parse(req.params);
    const walletAddress = req.auth.walletAddress.toLowerCase();
    const asset = await AssetModel.findOne({ _id: parsedParams.assetId })
      .select(
        "_id ownerWallet filename sha256 currentVersion status blockchainAssetId registrationTransactionHash registrationBlockNumber blockchainVerificationStatus createdAt updatedAt"
      )
      .lean();

    if (!asset) {
      throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    const isOwner = asset.ownerWallet.toLowerCase() === walletAddress;
    if (!isOwner) {
      if (!asset.blockchainAssetId || asset.blockchainVerificationStatus !== "verified") {
        throw accessDenied();
      }

      const blockchain = createBlockchainReadService();
      const permission = await blockchain.getPermission(asset.blockchainAssetId, walletAddress).catch(() => "NONE");
      if (permission === "NONE") {
        throw accessDenied();
      }
    }

    return res.json({
      blockchain: await safeBlockchainAssetDetail(asset)
    });
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

    const parsedParams = moveAssetFolderParamsSchema.parse(req.params);
    const walletAddress = req.auth.walletAddress.toLowerCase();
    const { asset, assetVersion, wrappedKey, permission, currentVersion, sha256 } = await loadAuthorizedEncryptedAsset(
      parsedParams.assetId,
      walletAddress
    );

    return res.json({
      asset: {
        assetId: asset._id?.toString(),
        blockchainAssetId: asset.blockchainAssetId,
        filename: asset.filename,
        mimeType: asset.mimeType || "application/octet-stream",
        size: typeof asset.size === "number" ? asset.size : 0,
        permission,
        currentVersion,
        sha256,
        expectedSha256: sha256,
        encryptionMetadata: assetVersion.encryptionMetadata,
        ciphertextUrl: `/api/assets/${asset._id?.toString()}/ciphertext`,
        EK_User: wrappedKey.wrappedAESKey,
        wrappingMetadata: wrappedKey.wrappingMetadata
      }
    });
  } catch (error) {
    return next(error);
  }
});

assetsRouter.get("/:assetId/ciphertext", requireAuth, async (req, res, next) => {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
    }

    const parsedParams = moveAssetFolderParamsSchema.parse(req.params);
    const walletAddress = req.auth.walletAddress.toLowerCase();
    const { asset, assetVersion } = await loadAuthorizedEncryptedAsset(parsedParams.assetId, walletAddress);
    const encryptedAsset = await getEncryptedAsset(assetVersion.encryptedStorageReference);
    if (!encryptedAsset) {
      throw new HttpError(404, "ENCRYPTED_ASSET_NOT_FOUND", "Encrypted asset not found");
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(encryptedAsset.byteLength));
    res.setHeader("Content-Disposition", `attachment; filename="${asset.filename}"`);
    return res.send(encryptedAsset.encryptedBytes);
  } catch (error) {
    return next(error);
  }
});
