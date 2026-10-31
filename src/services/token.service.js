const {
  randomBytes,
  randomUUID,
  createHash,
} = require("node:crypto");

const jwt = require("jsonwebtoken");
const pool = require("../config/db");

function hashRefreshToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createAccessToken(userId) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 64) {
    throw new Error("JWT_SECRET must be configured with a strong secret");
  }

  return jwt.sign(
    { tokenType: "access" },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      subject: String(userId),
      issuer: process.env.JWT_ISSUER || "fincore-api",
      audience: process.env.JWT_AUDIENCE || "fincore-client",
      expiresIn: process.env.ACCESS_TOKEN_TTL || "10m",
    }
  );
}

function createRefreshToken() {
  // 32 random bytes = 256 bits of randomness.
  return randomBytes(32).toString("base64url");
}

async function saveRefreshToken(connection, {
  userId,
  familyId,
  token,
}) {
  const tokenHash = hashRefreshToken(token);

  await connection.execute(
    `INSERT INTO refresh_tokens
       (user_id, family_id, token_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY))`,
    [
      userId,
      familyId,
      tokenHash,
      Number(process.env.REFRESH_TOKEN_DAYS || 7),
    ]
  );

  return tokenHash;
}

async function issueInitialTokens(userId) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const familyId = randomUUID();
    const refreshToken = createRefreshToken();

    await saveRefreshToken(connection, {
      userId,
      familyId,
      token: refreshToken,
    });

    await connection.commit();

    return {
      accessToken: createAccessToken(userId),
      refreshToken,
      tokenType: "Bearer",
      expiresIn: 600,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  hashRefreshToken,
  createAccessToken,
  createRefreshToken,
  saveRefreshToken,
  issueInitialTokens,
};