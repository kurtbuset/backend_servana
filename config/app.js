require("dotenv").config();
const supabase = require("../helpers/supabaseClient");

const isProduction = process.env.NODE_ENV === "production";

module.exports = {
  supabase,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiry: "15m", // 15 minutes
    refreshExpiry: "7d", // 7 days
    cookieOptions: {  
      httpOnly: true,
      secure: isProduction, // Only true in production
      sameSite: isProduction ? "Strict" : "Lax",// Adjust based on your needs in development
    },
  },
};