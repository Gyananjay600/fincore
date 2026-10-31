
const router = require("express").Router();
const crypto = require("node:crypto");
const { z } = require("zod");

const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");

const transferSchema = z.object({
  senderWalletId: z.string().regex(/^[1-9]\d{0,19}$/),
  recipientWalletId: z.string().regex(/^[1-9]\d{0,19}$/),
  amountPaise: z.string().regex(/^[1-9]\d{0,17}$/),
}).strict();

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function hashRequest(senderId, recipientId, amountPaise) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      senderWalletId: senderId,
      recipientWalletId: recipientId,
      amountPaise,
      currency: "INR",
    }))
    .digest("hex");
}

router.post("/", requireAuth, async (req, res, next) => {
  const parsed = transferSchema.safeParse(req.body);
  const idempotencyKey = req.get("Idempotency-Key");

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_REQUEST",
        message: "Provide valid wallet IDs and a positive amount in paise.",
        requestId: req.requestId,
      },
    });
  }

  if (
    !idempotencyKey ||
    idempotencyKey.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
  ) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "A valid Idempotency-Key header is required.",
        requestId: req.requestId,
      },
    });
  }

  const { senderWalletId, recipientWalletId, amountPaise } = parsed.data;

  if (senderWalletId === recipientWalletId) {
    return res.status(400).json({
      success: false,
      error: {
        code: "SAME_WALLET",
        message: "Sender and recipient must be different wallets.",
        requestId: req.requestId,
      },
    });
  }

  // Reject amounts beyond JavaScript's safe integer range.
  // Keep amounts as strings in SQL and JSON.
  if (BigInt(amountPaise) > BigInt(Number.MAX_SAFE_INTEGER)) {
    return res.status(400).json({
      success: false,
      error: {
        code: "AMOUNT_TOO_LARGE",
        message: "The requested amount is too large.",
        requestId: req.requestId,
      },
    });
  }

  const requestHash = hashRequest(
    senderWalletId,
    recipientWalletId,
    amountPaise
  );

  let connection;
  let transactionStarted = false;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    // Always request locks in ascending wallet-ID order.
    // This helps reduce deadlocks between opposing transfers.
    const walletIds = [senderWalletId, recipientWalletId].sort(
      (a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)
    );

    const [wallets] = await connection.execute(
      `SELECT id, user_id, currency, balance_paise, status
       FROM wallets
       WHERE id IN (?, ?)
       ORDER BY id
       FOR UPDATE`,
      walletIds
    );

    const walletById = new Map(
      wallets.map((wallet) => [String(wallet.id), wallet])
    );

    const sender = walletById.get(senderWalletId);
    const recipient = walletById.get(recipientWalletId);

    if (!sender || !recipient) {
      throw new HttpError(404, "WALLET_NOT_FOUND", "Wallet not found.");
    }

    // Never trust a sender ID supplied by the client alone.
    if (String(sender.user_id) !== String(req.user.id)) {
      throw new HttpError(
        403,
        "SENDER_WALLET_FORBIDDEN",
        "You cannot transfer from this wallet."
      );
    }

    // Same sender + same idempotency key = same logical request.
    const [existingTransfers] = await connection.execute(
      `SELECT id, request_hash, status, amount_paise, currency
       FROM transfers
       WHERE sender_wallet_id = ? AND idempotency_key = ?
       LIMIT 1`,
      [senderWalletId, idempotencyKey]
    );

    if (existingTransfers.length > 0) {
      const existing = existingTransfers[0];

      if (existing.request_hash !== requestHash) {
        throw new HttpError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This key was already used for a different request."
        );
      }

      await connection.commit();
      transactionStarted = false;

      return res.status(200).json({
        success: true,
        data: {
          transferId: String(existing.id),
          status: existing.status,
          amountPaise: String(existing.amount_paise),
          currency: existing.currency,
          replayed: true,
        },
      });
    }

    if (sender.status !== "ACTIVE" || recipient.status !== "ACTIVE") {
      throw new HttpError(
        409,
        "WALLET_NOT_ACTIVE",
        "Both wallets must be active."
      );
    }

    if (sender.currency !== recipient.currency || sender.currency !== "INR") {
      throw new HttpError(
        400,
        "CURRENCY_MISMATCH",
        "Both wallets must use the same supported currency."
      );
    }

    if (BigInt(String(sender.balance_paise)) < BigInt(amountPaise)) {
      throw new HttpError(
        422,
        "INSUFFICIENT_FUNDS",
        "The sender wallet has insufficient funds."
      );
    }

    const [transferResult] = await connection.execute(
      `INSERT INTO transfers
        (sender_wallet_id, recipient_wallet_id, amount_paise,
         currency, idempotency_key, request_hash, status)
       VALUES (?, ?, ?, ?, ?, ?, 'PROCESSING')`,
      [
        senderWalletId,
        recipientWalletId,
        amountPaise,
        sender.currency,
        idempotencyKey,
        requestHash,
      ]
    );

    const transferId = String(transferResult.insertId);

    // Conditional debit provides another balance safety check.
    const [debitResult] = await connection.execute(
      `UPDATE wallets
       SET balance_paise = balance_paise - ?
       WHERE id = ?
         AND status = 'ACTIVE'
         AND balance_paise >= ?`,
      [amountPaise, senderWalletId, amountPaise]
    );

    if (debitResult.affectedRows !== 1) {
      throw new HttpError(
        422,
        "INSUFFICIENT_FUNDS",
        "The sender wallet could not be debited."
      );
    }

    const [creditResult] = await connection.execute(
      `UPDATE wallets
       SET balance_paise = balance_paise + ?
       WHERE id = ? AND status = 'ACTIVE'`,
      [amountPaise, recipientWalletId]
    );

    if (creditResult.affectedRows !== 1) {
      throw new HttpError(
        409,
        "RECIPIENT_NOT_ACTIVE",
        "The recipient wallet could not be credited."
      );
    }

    // Double-entry ledger: one debit and one matching credit.
    await connection.execute(
      `INSERT INTO ledger_entries
        (transfer_id, wallet_id, entry_type, amount_paise, currency)
       VALUES (?, ?, 'DEBIT', ?, ?),
              (?, ?, 'CREDIT', ?, ?)`,
      [
        transferId, senderWalletId, amountPaise, sender.currency,
        transferId, recipientWalletId, amountPaise, sender.currency,
      ]
    );

    await connection.execute(
      `UPDATE transfers
       SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND status = 'PROCESSING'`,
      [transferId]
    );

    await connection.commit();
    transactionStarted = false;

    return res.status(201).json({
      success: true,
      data: {
        transferId,
        status: "COMPLETED",
        amountPaise,
        currency: sender.currency,
        replayed: false,
      },
    });
  } catch (error) {
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Transfer rollback failed:", rollbackError.message);
      }
    }

    if (error instanceof HttpError) {
      return res.status(error.status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          requestId: req.requestId,
        },
      });
    }

    // Don't expose raw SQL errors to API clients.
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
