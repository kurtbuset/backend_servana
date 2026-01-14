const jwt = require("jsonwebtoken");
require("dotenv").config(); // make sure this is at the top


const getCurrentMobileUser = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.userId = decoded.client_id; // Make sure your token has client_id
    next();
  } catch (err) {
    console.error("JWT error:", err.message);
    return res.status(403).json({ error: "Invalid token" });
  }
};

module.exports = getCurrentMobileUser;
