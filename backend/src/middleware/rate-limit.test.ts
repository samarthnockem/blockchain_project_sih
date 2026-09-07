import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit.js";

function createRateLimitTestApp() {
  const app = express();

  app.use(
    createRateLimiter({
      windowMs: 60_000,
      max: 2
    })
  );
  app.get("/limited", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}

describe("rate limiting", () => {
  it("allows requests below the configured limit", async () => {
    const app = createRateLimitTestApp();

    await request(app).get("/limited").expect(200);
    await request(app).get("/limited").expect(200);
  });

  it("returns a consistent 429 response after the configured limit", async () => {
    const app = createRateLimitTestApp();

    await request(app).get("/limited").expect(200);
    await request(app).get("/limited").expect(200);
    const response = await request(app).get("/limited").expect(429);

    expect(response.body).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again later."
      }
    });
  });
});
