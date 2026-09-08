import { Schema, model, models, type InferSchemaType } from "mongoose";
import { assertNoForbiddenFields } from "./schema-guards.js";

const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;

const wrappingMetadataSchema = new Schema(
  {
    algorithm: {
      type: String,
      required: true,
      enum: ["RSA-OAEP"]
    },
    keyId: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 255
    }
  },
  {
    _id: false,
    strict: "throw"
  }
);

const wrappedKeySchema = new Schema(
  {
    assetId: {
      type: Schema.Types.ObjectId,
      ref: "Asset",
      required: true,
      index: true
    },
    userWallet: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: walletAddressPattern,
      index: true
    },
    wrappedAESKey: {
      type: String,
      required: true,
      trim: true,
      minlength: 1
    },
    version: {
      type: Number,
      required: true,
      min: 1
    },
    wrappingMetadata: {
      type: wrappingMetadataSchema,
      required: true
    },
    active: {
      type: Boolean,
      required: true,
      default: true,
      index: true
    }
  },
  {
    timestamps: true,
    strict: "throw"
  }
);

wrappedKeySchema.index({ assetId: 1, userWallet: 1, version: 1 }, { unique: true });
wrappedKeySchema.index({ assetId: 1, userWallet: 1, active: 1 });

assertNoForbiddenFields(wrappedKeySchema, "WrappedKey");

export type WrappedKey = InferSchemaType<typeof wrappedKeySchema>;
export const WrappedKeyModel = models.WrappedKey || model("WrappedKey", wrappedKeySchema);
