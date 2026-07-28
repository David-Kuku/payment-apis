import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

// A UNIT test: pure logic, no HTTP, no database.
describe("password hashing", () => {
  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("supersecret123");
    expect(await verifyPassword("supersecret123", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("supersecret123");
    expect(await verifyPassword("wrongpassword", hash)).toBe(false);
  });

  it("produces a different hash each time (per-password salt)", async () => {
    const a = await hashPassword("samepassword");
    const b = await hashPassword("samepassword");
    expect(a).not.toBe(b); // different salts → different hashes
    // ...but both still verify
    expect(await verifyPassword("samepassword", a)).toBe(true);
    expect(await verifyPassword("samepassword", b)).toBe(true);
  });
});
