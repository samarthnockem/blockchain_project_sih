import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { HttpError } from "../errors/http-error.js";
import { RequestValidationError } from "./validate-request.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({
      error: {
        code: "MALFORMED_JSON",
        message: "Request body contains malformed JSON"
      }
    });
  }

  if (error instanceof RequestValidationError || error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request input"
      }
    });
  }

  if (error instanceof HttpError) {
    return res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }

  logger.error({ error }, "Unhandled request error");

  return res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      ...(env.NODE_ENV === "production" ? {} : { stack: error instanceof Error ? error.stack : undefined })
    }
  });
};
