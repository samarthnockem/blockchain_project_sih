import type { Schema } from "mongoose";

export const forbiddenSensitiveFields = [
  "privateKey",
  "walletPrivateKey",
  "aesKey",
  "rawKey",
  "password",
  "seedPhrase"
] as const;

export function assertNoForbiddenFields(schema: Schema, modelName: string) {
  for (const field of forbiddenSensitiveFields) {
    if (schema.path(field)) {
      throw new Error(`${modelName} schema must not define forbidden field: ${field}`);
    }
  }
}
