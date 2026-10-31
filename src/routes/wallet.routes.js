
const router = require("express").Router();
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");

// Create a wallet for the authenticated user.
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [result] = await pool.execute(
      `INSERT INTO wallets (user_id, currency)
       VALUES (?, 'INR')`,
      [userId]
    );

    return res.status(201).json({
      success: true,
      data: {
        id: String(result.insertId),
        currency: "INR",
        balancePaise: "0",
        status: "ACTIVE",
      },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        error: {
          code: "WALLET_ALREADY_EXISTS",
          message: "An INR wallet already exists for this user",
          requestId: req.requestId,
        },
      });
    }

    next(error);
  }
});

// List only wallets owned by the authenticated user.
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const [wallets] = await pool.execute(
      `SELECT id, currency, balance_paise, status, created_at
       FROM wallets
       WHERE user_id = ?
       ORDER BY id`,
      [req.user.id]
    );

    return res.status(200).json({
      success: true,
      data: wallets.map((wallet) => ({
        id: String(wallet.id),
        currency: wallet.currency,
        balancePaise: String(wallet.balance_paise),
        status: wallet.status,
        createdAt: wallet.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
