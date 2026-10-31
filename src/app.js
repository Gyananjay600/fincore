
const express = require("express");
const helmet = require("helmet");
const pool = require("./config/db");
const walletRoutes = require("./routes/wallet.routes");

const authRoutes = require("./routes/auth.routes");
const transferRoutes = require("./routes/transfer.routes");
const devFundingRoutes = require("./routes/dev-funding.routes");
const {
  requestId,
  notFound,
  errorHandler,
} = require("./middleware/errors");

const app = express();

app.use(requestId);
app.use(helmet());
app.use(express.json({ limit: "10kb" }));

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to FinCore API",
  });
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      success: true,
      data: { api: "up", database: "connected" },
    });
  } catch {
    res.status(503).json({
      success: false,
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Service temporarily unavailable",
        requestId: req.requestId,
      },
    });
  }
});

app.use("/auth", authRoutes);
app.use("/wallets", walletRoutes);
app.use("/transfers", transferRoutes);
app.use("/dev/funding", devFundingRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
