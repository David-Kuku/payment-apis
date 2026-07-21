import express from "express";
import "dotenv/config";
import { query } from "./db.js";
import { authRouter } from "./auth/auth.routes.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { logger } from "./logger.js";

const app = express();

// Request logging goes FIRST so every request gets a correlation id and is
// logged, even if it fails in a later middleware.
app.use(requestLogger);

// Tells Express to automatically parse JSON request bodies into `req.body`.
app.use(express.json());

// Mount the auth module. Everything in authRouter is prefixed with /auth,
// so POST /register inside it becomes POST /auth/register.
app.use("/auth", authRouter);

/**
 * A health check. Two jobs:
 *  1. Confirm the API itself is up.
 *  2. Confirm it can actually reach the database (SELECT 1 is the classic ping).
 */
app.get("/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    res.status(500).json({ status: "error", database: "unreachable" });
  }
});

// The GLOBAL ERROR HANDLER goes LAST — after every route. Express only reaches
// it when a route above throws or calls next(err). Anything thrown in a
// controller (via asyncHandler) or middleware lands here.
app.use(errorHandler);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  logger.info(`🚀 API listening on http://localhost:${port}`);
});
