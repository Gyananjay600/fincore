
const router = require("express").Router();
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");

router.post("/", requireAuth, async (req, res, next) => {
  // This route must never be available outside local development.
  if (process.env.NODE_ENV !== "development") {
    return res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });
  }

  const { walletId, amountPaise } = req.body || {};

  if (
    typeof walletId !== "string" ||
    !/^[1-9]\d{0,19}$/.test(walletId) ||
    typeof amountPaise !== "string" ||
    !/^[1-9]\d{0,8}$/.test(amountPaise)
  ) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_REQUEST",
        message: "walletId and positive amountPaise strings are required.",
      },
    });
  }

  const amount = BigInt(amountPaise);

  if (amount > 100000000n) {
    return res.status(400).json({
      success: false,
      error: {
        code: "AMOUNT_TOO_LARGE",
        message: "Test funding is limited to ₹1,000,000 per request.",
      },
    });
  }

  let connection;
  let transactionStarted = false;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [walletRows] = await connection.execute(
      `SELECT id, user_id, currency, status
       FROM wallets
       WHERE id = ?
       FOR UPDATE`,
      [walletId]
    );

    const wallet = walletRows[0];

    if (!wallet) {
      const error = new Error("Wallet not found.");
      error.status = 404;
      error.code = "WALLET_NOT_FOUND";
      throw error;
    }

    if (String(wallet.user_id) !== String(req.user.id)) {
      const error = new Error("You cannot fund another user's wallet.");
      error.status = 403;
      error.code = "WALLET_FORBIDDEN";
      throw error;
    }

    if (wallet.status !== "ACTIVE" || wallet.currency !== "INR") {
      const error = new Error("Wallet must be active and use INR.");
      error.status = 409;
      error.code = "WALLET_NOT_FUNDABLE";
      throw error;
    }

    const [fundingResult] = await connection.execute(
      `INSERT INTO funding_records
         (wallet_id, amount_paise, currency, source)
       VALUES (?, ?, ?, 'SIMULATED_TEST')`,
      [walletId, amountPaise, wallet.currency]
    );

    await connection.execute(
      `UPDATE wallets
       SET balance_paise = balance_paise + ?
       WHERE id = ?`,
      [amountPaise, walletId]
    );

    await connection.execute(
      `INSERT INTO ledger_entries
         (transfer_id, wallet_id, entry_type, amount_paise, currency)
       VALUES (NULL, ?, 'FUNDING', ?, ?)`,
      [walletId, amountPaise, wallet.currency]
    );

    await connection.commit();
    transactionStarted = false;

    return res.status(201).json({
      success: true,
      data: {
        fundingId: String(fundingResult.insertId),
        walletId,
        amountPaise,
        currency: wallet.currency,
        type: "SIMULATED_TEST",
      },
    });
  } catch (error) {
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Funding rollback failed:", rollbackError.message);
      }
    }

    if (error.status) {
      return res.status(error.status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          requestId: req.requestId,
        },
      });
    }

    next(error);
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
