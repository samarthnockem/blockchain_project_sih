import { Schema, model, models, type InferSchemaType } from "mongoose";
import { assertNoForbiddenFields } from "./schema-guards.js";

const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const sha256Pattern = /^[a-fA-F0-9]{64}$/;
const transactionHashPattern = /^0x[a-fA-F0-9]{64}$/;

const assetVersionSchema = new Schema(
  {
    assetId: {
      type: Schema.Types.ObjectId,
      ref: "Asset",
      required: true,
      index: true
    },
    version: {
      type: Number,
      required: true,
      min: 1
    },
    encryptedStorageReference: {
      type: String,
      required: true,
      trim: true,
      minlength: 1
    },
    sha256: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: sha256Pattern
    },
    createdBy: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: walletAddressPattern,
      index: true
    },
    commitMessage: {
      type: String,
      trim: true,
      maxlength: 500
    },
    blockchainTransactionHash: {
      type: String,
      trim: true,
      match: transactionHashPattern,
      sparse: true,
      index: true
    }
  },
  {
    timestamps: true,
    strict: "throw"
  }
);

assetVersionSchema.index({ assetId: 1, version: 1 }, { unique: true });

assertNoForbiddenFields(assetVersionSchema, "AssetVersion");

export type AssetVersion = InferSchemaType<typeof assetVersionSchema>;
export const AssetVersionModel = models.AssetVersion || model("AssetVersion", assetVersionSchema);
