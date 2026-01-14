const bycrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");

const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require("../utils/jwt");

const { cookieOptions } = require("../config");

const supabase = createClient(
  process.env.REACT_SUPABASE_URL,
  process.env.REACT_SUPABASE_ANON_KEY
);

exports.register = async (req, res) => {
  const { email, password } = req.body;

  const { data: existingUser } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (existingUser)
    return res.status(400).json({ message: "Email already exists" });

  const password_hash = await bycrypt.hash(password, 12);

  const { data: user, error } = await supabase
    .from("users")
    .insert({ email, password_hash })
    .select()
    .single();

  if (error)
    return res.status(500).json({ message: "Error creating user", error });

  const accessToken = generateAccessToken({ id: user.id });
  const refreshToken = generateRefreshToken({ id: user.id });

  res
    .cookie("refreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    })
    .status(201)
    .json({ accessToken });
};

exports.login = async (req, res) => {
  const { email, password } = req.body;

  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (!user || !(await bycrypt.compare(password, user.password_hash)))
    return res.status(401).json({ message: "Invalid email or password" });

  const accessToken = generateAccessToken({ id: user.id });
  const refreshToken = generateRefreshToken({ id: user.id });

  res
    .cookie("refreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    })
    .status(200)
    .json({ accessToken });
};

exports.refresh = async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token)
    return res.status(401).json({ message: "No refresh token provided" });

  try {
    const decoded = verifyRefreshToken(token);
    const accessToken = generateAccessToken({ id: decoded.id });
    res.json({ accessToken });
  } catch {
    res.status(401).json({ message: "Invalid refresh token" });
  }
};

exports.logout = (req, res) => {
  res.clearCookie("refreshToken", cookieOptions);
  res.json({ message: "Logged out successfully" });
};

exports.profile = async (req, res) => {
  const { data: user } = await supabase
    .from("users")
    .select("id, email")
    .eq("id", req.user.id)
    .single();

  res.json(user);
};
