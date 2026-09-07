import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().trim().min(1, "MONGODB_URI is required").refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "mongodb:" || parsed.protocol === "mongodb+srv:";
    } catch {
      return false;
    }
  }, "MONGODB_URI must be a valid MongoDB connection string"),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  JSON_BODY_LIMIT: z.string().min(1).default("1mb"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  SENSITIVE_ACTION_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  SENSITIVE_ACTION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  AUTH_NONCE_TTL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  SESSION_TTL_MS: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
});

export const env = envSchema.parse(process.env);
