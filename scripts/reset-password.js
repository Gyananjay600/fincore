// if you forgot then reset se the new password here
require("dotenv").config();

const argon2 = require("argon2");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const pool = require("../src/config/db");

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const email = (
      await rl.question("Registered email: ")
    ).trim().toLowerCase();

    const newPassword = await rl.question("New password (input visible): ");

    if (!email || newPassword.length < 12 || newPassword.length > 128) {
      throw new Error("Email is required; password must be 12–128 characters.");
    }

    const [users] = await pool.execute(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    if (users.length === 0) {
      throw new Error("No registered user found for that email.");
    }

    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });

    await pool.execute(
      "UPDATE users SET password_hash = ? WHERE id = ?",
      [passwordHash, users[0].id]
    );

    // Revoke existing refresh sessions for this user.
    await pool.execute(
      `UPDATE refresh_tokens
       SET revoked_at = UTC_TIMESTAMP(3)
       WHERE user_id = ? AND revoked_at IS NULL`,
      [users[0].id]
    );

    console.log("Password reset successful. Existing refresh sessions revoked.");
  } finally {
    rl.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Password reset failed:", error.message);
  process.exitCode = 1;
});
