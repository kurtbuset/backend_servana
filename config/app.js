require("dotenv").config();
const supabase = require("../helpers/supabaseClient");

module.exports = {
  supabase,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiry: "15m", // 15 minutes
    refreshExpiry: "7d", // 7 days
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
    },
  },
};