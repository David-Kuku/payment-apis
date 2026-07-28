import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "../app.js";
import { setupTwoWallets, getBalance } from "../test/helpers.js";

/** Helper: POST /transfers with a required idempotency key. */
function transfer(token: string, key: string, body: unknown) {
  return request(app)
    .post("/transfers")
    .set("Authorization", `Bearer ${token}`)
    .set("Idempotency-Key", key)
    .send(body);
}

describe("transfers", () => {
  it("moves money and updates both balances", async () => {
    const { senderToken, senderWallet, receiverWallet } = await setupTwoWallets(100_000);

    const res = await transfer(senderToken, randomUUID(), {
      fromWalletId: senderWallet.id,
      toWalletId: receiverWallet.id,
      amount: 30_000,
    });

    expect(res.status).toBe(201);
    expect(await getBalance(senderWallet.id)).toBe(70_000n);
    expect(await getBalance(receiverWallet.id)).toBe(30_000n);
  });

  it("rejects an overdraft and leaves balances untouched", async () => {
    const { senderToken, senderWallet, receiverWallet } = await setupTwoWallets(1_000);

    const res = await transfer(senderToken, randomUUID(), {
      fromWalletId: senderWallet.id,
      toWalletId: receiverWallet.id,
      amount: 5_000,
    });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("insufficient_funds");
    expect(await getBalance(senderWallet.id)).toBe(1_000n);
    expect(await getBalance(receiverWallet.id)).toBe(0n);
  });

  it("forbids sending from a wallet you don't own", async () => {
    const { receiverToken, senderWallet, receiverWallet } = await setupTwoWallets();

    // The receiver tries to pull money FROM the sender's wallet.
    const res = await transfer(receiverToken, randomUUID(), {
      fromWalletId: senderWallet.id,
      toWalletId: receiverWallet.id,
      amount: 100,
    });

    expect(res.status).toBe(403);
  });

  it("is idempotent: the same key transfers exactly once", async () => {
    const { senderToken, senderWallet, receiverWallet } = await setupTwoWallets(100_000);
    const key = randomUUID();
    const body = {
      fromWalletId: senderWallet.id,
      toWalletId: receiverWallet.id,
      amount: 10_000,
    };

    const first = await transfer(senderToken, key, body);
    const second = await transfer(senderToken, key, body); // retry, same key

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // Same transaction id → the second was replayed, not re-executed.
    expect(second.body.transfer.transactionId).toBe(first.body.transfer.transactionId);
    // Money moved once, not twice.
    expect(await getBalance(senderWallet.id)).toBe(90_000n);
    expect(await getBalance(receiverWallet.id)).toBe(10_000n);
  });

  // The crown jewel: attack.ts turned into an automated guarantee.
  it("stays consistent under concurrent transfers — no money created or lost", async () => {
    const { senderToken, senderWallet, receiverWallet } = await setupTwoWallets(100_000);
    const N = 20;
    const amount = 100;

    // Fire N transfers at once, each with its OWN idempotency key (distinct
    // operations, not retries).
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        transfer(senderToken, randomUUID(), {
          fromWalletId: senderWallet.id,
          toWalletId: receiverWallet.id,
          amount,
        }),
      ),
    );

    const successes = results.filter((r) => r.status === 201).length;
    // Under heavy contention on one wallet, optimistic locking may exhaust
    // retries for a few (409). That's fine — we assert CONSISTENCY, not a fixed
    // success count. Whatever succeeded, the books MUST balance exactly.
    expect(successes).toBeGreaterThan(0);

    const finalSender = await getBalance(senderWallet.id);
    const finalReceiver = await getBalance(receiverWallet.id);

    expect(finalSender).toBe(BigInt(100_000 - successes * amount));
    expect(finalReceiver).toBe(BigInt(successes * amount));
    // Total money is unchanged — none created, none destroyed.
    expect(finalSender + finalReceiver).toBe(100_000n);
  });
});
