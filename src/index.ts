// NOTE: tracing is NOT imported here. It's preloaded via `--import ./src/tracing.ts`
// in the "dev" script (package.json), so the SDK patches http/express/pg BEFORE
// any of them load. A top-level import here loads too late under tsx's ESM
// loader — pg's query method wouldn't get instrumented.
import { app } from "./app.js";
import { logger } from "./logger.js";

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  logger.info(`🚀 API listening on http://localhost:${port}`);
});
