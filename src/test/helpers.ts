import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db.js";

/** Register a merchant and return a login token. */
export async function registerAndLogin(
  email: string,
  password = "supersecret123",
): Promise<string> {
  await request(app).post("/auth/register").send({ email, password });
  const res = await request(app).post("/auth/login").send({ email, password });
  return res.body.token as string;
}

/** Create a wallet for a token holder. */
export async function createWallet(token: string, currency = "NGN") {
  const res = await request(app)
    .post("/wallets")
    .set("Authorization", `Bearer ${token}`)
    .send({ currency });
  return res.body.wallet as { id: string; currency: string; balance: string };
}

/** Directly set a wallet balance (test setup shortcut). */
export async function setBalance(walletId: string, amount: number): Promise<void> {
  await pool.query(`UPDATE wallets SET balance = $1 WHERE id = $2`, [amount, walletId]);
}

/** Read a wallet balance as a BigInt. */
export async function getBalance(walletId: string): Promise<bigint> {
  const { rows } = await pool.query(`SELECT balance FROM wallets WHERE id = $1`, [
    walletId,
  ]);
  return BigInt(rows[0].balance);
}

/**
 * Two merchants, each with an NGN wallet (a transfer needs same-currency wallets
 * owned by different merchants). The sender's wallet is funded.
 */
export async function setupTwoWallets(startBalance = 100_000) {
  const senderToken = await registerAndLogin("sender@shop.com");
  const receiverToken = await registerAndLogin("receiver@shop.com");
  const senderWallet = await createWallet(senderToken, "NGN");
  const receiverWallet = await createWallet(receiverToken, "NGN");
  await setBalance(senderWallet.id, startBalance);
  return { senderToken, receiverToken, senderWallet, receiverWallet };
}
