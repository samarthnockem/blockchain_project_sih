import { Schema, model, models, type InferSchemaType } from "mongoose";
import { assertNoForbiddenFields } from "./schema-guards.js";

const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;

const userSchema = new Schema(
  {
    walletAddress: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: walletAddressPattern
    },
    publicEncryptionKey: {
      type: String,
      required: true,
      trim: true,
      minlength: 1
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: 100
    },
    kycStatus: {
      type: String,
      enum: ["not_started", "pending", "verified", "rejected"]
    }
  },
  {
    timestamps: true,
    strict: "throw"
  }
);

assertNoForbiddenFields(userSchema, "User");

export type User = InferSchemaType<typeof userSchema>;
export const UserModel = models.User || model("User", userSchema);
