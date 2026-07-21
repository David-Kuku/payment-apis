import type { Logger } from "pino";

/**
 * Augment Express's Request type so TypeScript knows about the two fields our
 * request-logger middleware attaches to every request:
 *   - req.id:  the correlation id (unique per request)
 *   - req.log: a child logger already tagged with that id
 */
declare global {
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
      merchant?: { id: string; email: string };
    }
  }
}

export {};
