
const { randomUUID } = require("node:crypto");

function requestId(req, res, next) {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}

function notFound(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: "ROUTE_NOT_FOUND",
      message: "Route not found",
      requestId: req.requestId,
    },
  });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // Never log request bodies, authorization headers, or credentials.
  console.error({
    event: "request_failed",
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    code: err.code || "INTERNAL_ERROR",
  });

  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      requestId: req.requestId,
    },
  });
}

module.exports = { requestId, notFound, errorHandler };
