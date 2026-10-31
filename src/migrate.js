require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("./config/db");

async function migrate() {
  // This runner supports simple SQL migrations separated by semicolons.
  // Do not use this splitter for stored procedures or complex SQL scripts.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  const directory = path.join(__dirname, "..", "migrations");

  const files = (await fs.readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const [applied] = await pool.execute(
      "SELECT version FROM schema_migrations WHERE version = ?",
      [file]
    );

    if (applied.length > 0) {
      console.log(`Already applied: ${file}`);
      continue;
    }

    const sql = await fs.readFile(
      path.join(directory, file),
      "utf8"
    );

    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);

    console.log(`Applying: ${file}`);

    // MySQL DDL implicitly commits. If a migration fails halfway,
    // inspect the database and repair it before rerunning.
    for (const statement of statements) {
      await pool.query(statement);
    }

    await pool.execute(
      "INSERT INTO schema_migrations (version) VALUES (?)",
      [file]
    );

    console.log(`Applied: ${file}`);
  }
}

migrate()
  .catch((error) => {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
