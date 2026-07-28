/**
 * Return a copy of a Postgres connection URL pointing at a different database
 * (same host/credentials). Lets us derive the test DB URL and the maintenance
 * ("postgres") URL from whatever DATABASE_URL is set — host or container form.
 */
export function withDatabase(url: string, dbName: string): string {
  const u = new URL(url);
  u.pathname = "/" + dbName;
  return u.toString();
}
