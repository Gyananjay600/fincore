const router = require("express").Router();
const { z } = require("zod");
const argon2 = require("argon2");
const pool = require("../config/db");

const jwt = require("jsonwebtoken");
const { randomUUID } = require("node:crypto");

const {
  hashRefreshToken,
  createAccessToken,
  createRefreshToken,
  saveRefreshToken,
  issueInitialTokens,
} = require("../services/token.service");
const { requireAuth } = require("../middleware/auth");

const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
}).strict();

router.post("/register", async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Provide a valid email and password of 12–128 characters",
        requestId: req.requestId,
      },
    });
  }

  try {
    const email = parsed.data.email.toLowerCase();

    const passwordHash = await argon2.hash(
      parsed.data.password,
      { type: argon2.argon2id }
    );

    const [result] = await pool.execute(
      `INSERT INTO users (email, password_hash)
       VALUES (?, ?)`,
      [email, passwordHash]
    );

    return res.status(201).json({
      success: true,
      data: {
        id: String(result.insertId),
        email,
      },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        error: {
          code: "EMAIL_ALREADY_REGISTERED",
          message: "Unable to register with this email",
          requestId: req.requestId,
        },
      });
    }

    next(error);
  }
});

// login schema 
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
}).strict();

router.post("/login", async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Provide a valid email and password",
        requestId: req.requestId,
      },
    });
  }

  try {
    const email = parsed.data.email.toLowerCase();

    const [users] = await pool.execute(
      `SELECT id, email, password_hash
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [email]
    );

    const user = users[0];

    // Same public response for an unknown email and a wrong password.
    const passwordMatches = user
      ? await argon2.verify(user.password_hash, parsed.data.password)
      : false;

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password",
          requestId: req.requestId,
        },
      });
    }

    const tokens = await issueInitialTokens(user.id);

    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: String(user.id),
          email: user.email,
        },
        ...tokens,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Implement refresh-token rotation
const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(200),
}).strict();

router.post("/refresh", async (req, res, next) => {
  const parsed = refreshSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "A valid refresh token is required",
        requestId: req.requestId,
      },
    });
  }

  const oldToken = parsed.data.refreshToken;
  const oldHash = hashRefreshToken(oldToken);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT id, user_id, family_id, expires_at,
              revoked_at, replaced_by_hash
       FROM refresh_tokens
       WHERE token_hash = ?
       FOR UPDATE`,
      [oldHash]
    );

    const stored = rows[0];

    if (!stored) {
      await connection.rollback();
      return invalidRefresh(res, req);
    }

    if (stored.revoked_at) {
      // A rotated token was presented again: possible token theft.
      if (stored.replaced_by_hash) {
        await connection.execute(
          `UPDATE refresh_tokens
           SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(3))
           WHERE family_id = ?`,
          [stored.family_id]
        );

        await connection.commit();
      } else {
        await connection.rollback();
      }

      return invalidRefresh(res, req);
    }

    const [[clock]] = await connection.query(
      "SELECT (expires_at <= UTC_TIMESTAMP(3)) AS expired FROM refresh_tokens WHERE id = ?",
      [stored.id]
    );

    if (clock.expired) {
      await connection.execute(
        `UPDATE refresh_tokens
         SET revoked_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [stored.id]
      );
      await connection.commit();
      return invalidRefresh(res, req);
    }

    const newRefreshToken = createRefreshToken();
    const newHash = hashRefreshToken(newRefreshToken);

    await connection.execute(
      `UPDATE refresh_tokens
       SET revoked_at = UTC_TIMESTAMP(3),
           replaced_by_hash = ?
       WHERE id = ? AND revoked_at IS NULL`,
      [newHash, stored.id]
    );

    await saveRefreshToken(connection, {
      userId: stored.user_id,
      familyId: stored.family_id,
      token: newRefreshToken,
    });

    await connection.commit();

    return res.status(200).json({
      success: true,
      data: {
        accessToken: createAccessToken(stored.user_id),
        refreshToken: newRefreshToken,
        tokenType: "Bearer",
        expiresIn: 600,
      },
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}
    next(error);
  } finally {
    connection.release();
  }
});

function invalidRefresh(res, req) {
  return res.status(401).json({
    success: false,
    error: {
      code: "INVALID_REFRESH_TOKEN",
      message: "Refresh token is invalid or expired",
      requestId: req.requestId,
    },
  });
}

// refresh

const logoutSchema = z.object({
  refreshToken: z.string().min(1).max(200),
}).strict();

router.post("/logout", async (req, res, next) => {
  const parsed = logoutSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "A valid refresh token is required",
        requestId: req.requestId,
      },
    });
  }

  try {
    const tokenHash = hashRefreshToken(parsed.data.refreshToken);

    await pool.execute(
      `UPDATE refresh_tokens
       SET revoked_at = UTC_TIMESTAMP(3)
       WHERE token_hash = ? AND revoked_at IS NULL`,
      [tokenHash]
    );

    // Idempotent: do not reveal whether a token existed.
    return res.status(200).json({
      success: true,
      data: { message: "Logged out" },
    });
  } catch (error) {
    next(error);
  }
});


// A valid access JWT identifies the user; it does not automatically authorize access to another user's accounts or wallets.

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const [users] = await pool.execute(
      "SELECT id, email, created_at FROM users WHERE id = ? LIMIT 1",
      [req.user.id]
    );

    if (!users[0]) {
      return res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "User no longer exists",
          requestId: req.requestId,
        },
      });
    }

    return res.json({
      success: true,
      data: {
        id: String(users[0].id),
        email: users[0].email,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
