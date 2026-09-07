import { Router } from "express";
import { z } from "zod";
import { UserModel } from "../models/user.js";
import { requireAuth } from "../middleware/require-auth.js";
import { validateRequest } from "../middleware/validate-request.js";

const walletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const publicEncryptionKeySchema = z.string().trim().min(32).max(4096).regex(/^[A-Za-z0-9+/=._:-]+$/);

const updateEncryptionKeyBodySchema = z
  .object({
    publicEncryptionKey: publicEncryptionKeySchema
  })
  .strict();

const publicKeyParamsSchema = z
  .object({
    wallet: walletAddressSchema
  })
  .strict();

export const usersRouter = Router();

usersRouter.put(
  "/me/encryption-key",
  requireAuth,
  validateRequest({ body: updateEncryptionKeyBodySchema }),
  async (req, res, next) => {
    try {
      if (!req.auth) {
        return res.status(401).json({
          error: {
            code: "AUTH_REQUIRED",
            message: "Authentication required"
          }
        });
      }

      const { publicEncryptionKey } = req.body as z.infer<typeof updateEncryptionKeyBodySchema>;
      const walletAddress = req.auth.walletAddress.toLowerCase();

      await UserModel.findOneAndUpdate(
        { walletAddress },
        {
          $set: {
            walletAddress,
            publicEncryptionKey
          }
        },
        {
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true
        }
      );

      return res.json({
        walletAddress,
        publicEncryptionKey
      });
    } catch (error) {
      return next(error);
    }
  }
);

usersRouter.get("/:wallet/public-key", validateRequest({ params: publicKeyParamsSchema }), async (req, res, next) => {
  try {
    const { wallet } = req.params as z.infer<typeof publicKeyParamsSchema>;
    const walletAddress = wallet.toLowerCase();
    const user = await UserModel.findOne({ walletAddress }).select("walletAddress publicEncryptionKey -_id").lean();

    if (!user) {
      return res.status(404).json({
        error: {
          code: "PUBLIC_KEY_NOT_FOUND",
          message: "Public encryption key not found"
        }
      });
    }

    return res.json({
      walletAddress: user.walletAddress,
      publicEncryptionKey: user.publicEncryptionKey
    });
  } catch (error) {
    return next(error);
  }
});
