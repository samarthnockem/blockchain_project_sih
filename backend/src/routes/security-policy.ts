import { Router } from "express";
import { env } from "../config/env.js";

export const securityPolicyRouter = Router();

securityPolicyRouter.get("/", (_req, res) => {
  res.json({
    requireWalletForBlockchainActions: true,
    requireKycBeforeSharing: env.REQUIRE_KYC_BEFORE_SHARING,
    sources: {
      requireWalletForBlockchainActions: "application",
      requireKycBeforeSharing: "backend"
    }
  });
});
