import { Schema, model, models, type InferSchemaType } from "mongoose";
import { assertNoForbiddenFields } from "./schema-guards.js";

const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const sha256Pattern = /^[a-fA-F0-9]{64}$/;

const assetSchema = new Schema(
  {
    ownerWallet: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: walletAddressPattern,
      index: true
    },
    filename: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 255
    },
    blockchainAssetId: {
      type: String,
      trim: true,
      sparse: true,
      index: true
    },
    currentVersion: {
      type: Number,
      required: true,
      min: 1,
      default: 1
    },
    sha256: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: sha256Pattern,
      index: true
    },
    status: {
      type: String,
      required: true,
      enum: ["active", "archived", "revoked"],
      default: "active",
      index: true
    },
    passwordProtectionEnabled: {
      type: Boolean,
      required: true,
      default: false
    }
  },
  {
    timestamps: true,
    strict: "throw"
  }
);

assetSchema.index({ ownerWallet: 1, status: 1 });

assertNoForbiddenFields(assetSchema, "Asset");

export type Asset = InferSchemaType<typeof assetSchema>;
export const AssetModel = models.Asset || model("Asset", assetSchema);
