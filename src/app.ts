import express from "express";
import "dotenv/config";
import { query } from "./db.js";
import { authRouter } from "./auth/auth.routes.js";
import { walletRouter } from "./wallets/wallet.routes.js";
import { transferRouter } from "./transfers/transfer.routes.js";
import { paymentRouter } from "./payments/payment.routes.js";
import { webhookRouter } from "./webhooks/webhook.routes.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { metricsMiddleware } from "./middleware/metrics.js";
import { registry } from "./metrics.js";

/**
 * Builds and returns the Express app WITHOUT starting a server. index.ts calls
 * listen() on it for real; tests import it directly and drive it with supertest
 * (no port needed).
 */
export const app = express();

app.use(requestLogger);
app.use(metricsMiddleware);
app.use(express.json());

app.use("/auth", authRouter);
app.use("/wallets", walletRouter);
app.use("/transfers", transferRouter);
app.use("/payment-intents", paymentRouter);
app.use("/webhooks", webhookRouter);

/** DEV/TEST sink to receive webhook deliveries. ?fail=1 returns 500. */
app.post("/test/sink", (req, res) => {
  req.log.info(
    {
      event: req.headers["x-webhook-event"],
      signature: req.headers["x-webhook-signature"],
      body: req.body,
    },
    "🪝 test sink received a webhook",
  );
  if (req.query.fail) {
    return res.status(500).json({ ok: false });
  }
  res.status(200).json({ received: true });
});

/**
 * DEV receiver for Alertmanager. Alertmanager POSTs a JSON batch of alerts here
 * (grouped). We just log each one so you can SEE a firing alert arrive end-to-end
 * — in real life this receiver would be Slack/PagerDuty/email instead.
 */
app.post("/test/alerts", (req, res) => {
  const alerts = req.body?.alerts ?? [];
  for (const a of alerts) {
    req.log.warn(
      {
        status: a.status, // "firing" | "resolved"
        alertname: a.labels?.alertname,
        severity: a.labels?.severity,
        summary: a.annotations?.summary,
        description: a.annotations?.description,
      },
      "🚨 alert received from Alertmanager",
    );
  }
  res.status(200).json({ received: alerts.length });
});

/** Prometheus scrapes this — renders the registry in its text exposition format. */
app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});

app.get("/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    res.status(500).json({ status: "error", database: "unreachable" });
  }
});

// Global error handler must be registered LAST.
app.use(errorHandler);
