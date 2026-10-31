require("dotenv").config();

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const argon2 = require("argon2");
const request = require("supertest");

const app = require("../src/app");
const pool = require("../src/config/db");

const email = `auth-test-${randomUUID()}@example.com`;
const password = "FinCoreTestPassword123!";

let userId;

before(async () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 64) {
    throw new Error("Configure JWT_SECRET in .env before running tests");
  }

  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
  });

  const [result] = await pool.execute(
    "INSERT INTO users (email, password_hash) VALUES (?, ?)",
    [email, hash]
  );

  userId = result.insertId;
});

after(async () => {
  try {
    if (userId) {
      await pool.execute(
        "DELETE FROM refresh_tokens WHERE user_id = ?",
        [userId]
      );
      await pool.execute(
        "DELETE FROM accounts WHERE user_id = ?",
        [userId]
      );
      await pool.execute("DELETE FROM users WHERE id = ?", [userId]);
    }
  } finally {
    await pool.end();
  }
});

async function login() {
  const response = await request(app)
    .post("/auth/login")
    .send({ email, password });

  assert.equal(response.status, 200);
  assert.ok(response.body.data.accessToken);
  assert.ok(response.body.data.refreshToken);

  return response.body.data;
}

test("login returns access and refresh tokens for valid credentials", async () => {
  const result = await login();

  assert.equal(result.user.email, email);
  assert.equal(result.tokenType, "Bearer");
  assert.equal(typeof result.accessToken, "string");
});

test("login rejects an incorrect password", async () => {
  const response = await request(app)
    .post("/auth/login")
    .send({ email, password: "DefinitelyWrongPassword123!" });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "INVALID_CREDENTIALS");
});

test("login rejects an unknown email without revealing account existence", async () => {
  const response = await request(app)
    .post("/auth/login")
    .send({
      email: `missing-${randomUUID()}@example.com`,
      password,
    });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "INVALID_CREDENTIALS");
});

test("access token protects /auth/me", async () => {
  const tokens = await login();

  const response = await request(app)
    .get("/auth/me")
    .set("Authorization", `Bearer ${tokens.accessToken}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.email, email);
});

test("refresh rotates tokens and reuse revokes the token family", async () => {
  const original = await login();

  const rotated = await request(app)
    .post("/auth/refresh")
    .send({ refreshToken: original.refreshToken });

  assert.equal(rotated.status, 200);
  assert.notEqual(
    rotated.body.data.refreshToken,
    original.refreshToken
  );

  // Replaying the old token must fail and revoke its family.
  const replay = await request(app)
    .post("/auth/refresh")
    .send({ refreshToken: original.refreshToken });

  assert.equal(replay.status, 401);

  const afterReplay = await request(app)
    .post("/auth/refresh")
    .send({ refreshToken: rotated.body.data.refreshToken });

  assert.equal(afterReplay.status, 401);
});

test("logout revokes the refresh token", async () => {
  const tokens = await login();

  const logout = await request(app)
    .post("/auth/logout")
    .send({ refreshToken: tokens.refreshToken });

  assert.equal(logout.status, 200);

  const refresh = await request(app)
    .post("/auth/refresh")
    .send({ refreshToken: tokens.refreshToken });

  assert.equal(refresh.status, 401);
});

test("invalid request bodies are rejected", async () => {
  const response = await request(app)
    .post("/auth/login")
    .send({ email, password, unexpected: "field" });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});