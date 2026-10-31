const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  const authorization = req.get("authorization") || "";
  const [scheme, token, extra] = authorization.split(" ");

  if (scheme !== "Bearer" || !token || extra) {
    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "A valid access token is required",
        requestId: req.requestId,
      },
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: process.env.JWT_ISSUER || "fincore-api",
      audience: process.env.JWT_AUDIENCE || "fincore-client",
    });

    if (payload.tokenType !== "access" || !payload.sub) {
      throw new Error("Invalid token claims");
    }

    req.user = { id: payload.sub };
    next();
  } catch {
    return res.status(401).json({
      success: false,
      error: {
        code: "INVALID_ACCESS_TOKEN",
        message: "Access token is invalid or expired",
        requestId: req.requestId,
      },
    });
  }
}

module.exports = { requireAuth };