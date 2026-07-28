import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../app.js";

// An INTEGRATION test: drives the real app (routes → controllers → services →
// repositories → the test database) with supertest. No server/port needed.
describe("auth flow", () => {
  const email = "test@shop.com";
  const password = "supersecret123";

  it("registers, logs in, and returns the current merchant", async () => {
    const reg = await request(app).post("/auth/register").send({ email, password });
    expect(reg.status).toBe(201);
    expect(reg.body.merchant.email).toBe(email);
    // The hash must never leak to clients.
    expect(reg.body.merchant).not.toHaveProperty("password_hash");

    const login = await request(app).post("/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    const token = login.body.token;
    expect(token).toBeTruthy();

    const me = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.merchant.email).toBe(email);
  });

  it("rejects duplicate registration with 409", async () => {
    await request(app).post("/auth/register").send({ email, password });
    const dup = await request(app).post("/auth/register").send({ email, password });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("email_already_registered");
  });

  it("rejects wrong password with a generic 401", async () => {
    await request(app).post("/auth/register").send({ email, password });
    const res = await request(app)
      .post("/auth/login")
      .send({ email, password: "wrongpassword" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
  });

  it("rejects /auth/me without a token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("validates the request body (short password → 400)", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "x@y.com", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });
});
