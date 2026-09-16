import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./backend/src/app.js";
import { connectDatabase, isDatabaseReady } from "./backend/src/config/database.js";

const app = express();
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(rootDir, "frontend");

app.disable("x-powered-by");
app.use(express.static(frontendDir, { index: "index.html" }));

let databasePromise: Promise<void> | null = null;
app.use("/api", async (_req, res, next) => {
  try {
    if (!isDatabaseReady()) {
      databasePromise ??= connectDatabase().finally(() => {
        databasePromise = null;
      });
      await databasePromise;
    }
    next();
  } catch {
    res.status(503).json({
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Database connection unavailable"
      }
    });
  }
});

app.use(createApp());

export default app;
