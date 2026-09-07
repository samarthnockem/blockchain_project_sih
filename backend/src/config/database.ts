import mongoose from "mongoose";
import { env } from "./env.js";
import { logSecurityEvent, logger } from "./logger.js";

function sanitizeMongoMessage(message: string) {
  return message.replace(/(mongodb(?:\+srv)?:\/\/)([^:@/?#]+):([^@/?#]+)@/gi, "$1[redacted]:[redacted]@");
}

export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

export async function connectDatabase() {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      autoIndex: env.NODE_ENV !== "production"
    });
    logger.info("MongoDB connected");
  } catch (error) {
    const message = error instanceof Error ? sanitizeMongoMessage(error.message) : "Unknown MongoDB error";
    logSecurityEvent("database_connection_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      message
    });
    throw new Error("MongoDB connection failed");
  }
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info("MongoDB disconnected");
  }
}
