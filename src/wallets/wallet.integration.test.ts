import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { registerAndLogin } from "../test/helpers.js";

describe("wallets", () => {
  it("creates a wallet and lists it", async () => {
    const token = await registerAndLogin("wallet@shop.com");

    const create = await request(app)
      .post("/wallets")
      .set("Authorization", `Bearer ${token}`)
      .send({ currency: "NGN" });
    expect(create.status).toBe(201);
    expect(create.body.wallet.currency).toBe("NGN");
    expect(create.body.wallet.balance).toBe("0"); // BIGINT comes back as a string

    const list = await request(app)
      .get("/wallets")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.wallets).toHaveLength(1);
  });

  it("rejects a duplicate-currency wallet with 409", async () => {
    const token = await registerAndLogin("wallet2@shop.com");
    await request(app).post("/wallets").set("Authorization", `Bearer ${token}`).send({ currency: "NGN" });
    const dup = await request(app)
      .post("/wallets")
      .set("Authorization", `Bearer ${token}`)
      .send({ currency: "NGN" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("wallet_already_exists");
  });

  it("rejects an unsupported currency with 400", async () => {
    const token = await registerAndLogin("wallet3@shop.com");
    const res = await request(app)
      .post("/wallets")
      .set("Authorization", `Bearer ${token}`)
      .send({ currency: "EUR" });
    expect(res.status).toBe(400);
  });

  it("isolates wallets per merchant (you can't see others')", async () => {
    const a = await registerAndLogin("a@shop.com");
    const b = await registerAndLogin("b@shop.com");
    await request(app).post("/wallets").set("Authorization", `Bearer ${a}`).send({ currency: "NGN" });

    const bList = await request(app).get("/wallets").set("Authorization", `Bearer ${b}`);
    expect(bList.body.wallets).toHaveLength(0);
  });
});
