const supabase = require("../helpers/supabaseClient");
const jwtUtils = require("../utils/jwt");

/**
 * Simplified Socket Authentication Middleware
 * Handles both web (cookie) and mobile (JWT) authentication
 */

/**
 * Extract access token from cookies (web clients)
 */
function extractAccessTokenFromCookies(socket) {
  const cookies = socket.handshake.headers.cookie;

  if (!cookies) {
    throw new Error("No cookies found in request");
  }

  const cookieArray = cookies.split(";");

  for (const cookie of cookieArray) {
    const [name, value] = cookie.trim().split("=");
    if (name === "access_token") {
      return decodeURIComponent(value);
    }
  }

  throw new Error("Access token not found in cookies");
}

/**
 * Extract Bearer token from Authorization header (mobile clients)
 */
function extractBearerToken(socket) {
  const authHeader = socket.handshake.headers.authorization;

  if (!authHeader) {
    throw new Error("No Authorization header found");
  }

  if (!authHeader.startsWith("Bearer ")) {
    throw new Error(
      "Invalid Authorization header format. Expected: Bearer <token>",
    );
  }

  const token = authHeader.substring(7);

  if (!token) {
    throw new Error("No token found in Authorization header");
  }

  return token;
}

/**
 * Detect client type based on headers
 */
function detectClientType(socket) {
  const headers = socket.handshake.headers;

  // Check for JWT in Authorization header (mobile)
  if (headers.authorization && headers.authorization.startsWith("Bearer ")) {
    return "mobile";
  }

  // Check for cookies (web)
  if (headers.cookie && headers.cookie.includes("access_token")) {
    return "web";
  }

  throw new Error("No valid authentication method found");
}

/**
 * Authenticate web client using Supabase token
 */
async function authenticateWebClient(socket) {
  const token = extractAccessTokenFromCookies(socket);

  // Verify token with Supabase
  const { data: authData, error: authError } = await supabase.auth.getUser(
    token,
  );

  if (authError || !authData?.user) {
    throw new Error("Invalid or expired token");
  }

  // Get system user data
  const { data: systemUser, error } = await supabase
    .from("sys_user")
    .select(
      `
      sys_user_id,
      role_id,
      prof_id,
      sys_user_email,
      sys_user_is_active,
      role:role_id (
        role_name
      ),
      profile:prof_id (
        prof_firstname,
        prof_lastname
      )
    `,
    )
    .eq("supabase_user_id", authData.user.id)
    .eq("sys_user_is_active", true)
    .single();

  if (error || !systemUser) {
    throw new Error("System user not found or inactive");
  }

  return {
    userId: systemUser.sys_user_id,
    supabaseUserId: authData.user.id,
    userType: "agent",
    roleId: systemUser.role_id,
    profId: systemUser.prof_id,
    firstName: systemUser.profile?.prof_firstname,
    lastName: systemUser.profile?.prof_lastname,
    email: authData.user.email,
    isActive: true,
    token: token,
  };
}

/**
 * Authenticate mobile client using JWT
 */
async function authenticateMobileClient(socket) {
  const token = extractBearerToken(socket);

  // Verify and decode JWT
  const decoded = jwtUtils.verifyAccessToken(token);

  if (!decoded.client_id) {
    throw new Error("Invalid token: missing client_id");
  }

  // Get client data
  const { data: clientData, error } = await supabase
    .from("client")
    .select(
      `
      client_id,
      client_country_code,
      client_number,
      client_is_active,
      prof_id,
      profile:prof_id (
        prof_firstname,
        prof_lastname
      )
    `,
    )
    .eq("client_id", decoded.client_id)
    .single();

  if (error || !clientData) {
    throw new Error("Client not found");
  }

  if (!clientData.client_is_active) {
    throw new Error("Client account is inactive");
  }

  return {
    userId: clientData.client_id,
    userType: "client",
    clientId: clientData.client_id,
    profId: clientData.prof_id,
    firstName: clientData.profile?.prof_firstname,
    lastName: clientData.profile?.prof_lastname,
    countryCode: clientData.client_country_code,
    phoneNumber: clientData.client_number,
    isActive: clientData.client_is_active,
    token: token,
  };
}

/**
 * Main authentication middleware
 */
async function authenticateSocket(socket, next) {
  try {
    console.log(`🔍 Socket ${socket.id} attempting authentication`);
    console.log(`📋 Headers:`, {
      authorization: socket.handshake.headers.authorization
        ? "Present"
        : "Missing",
      cookie: socket.handshake.headers.cookie ? "Present" : "Missing",
      origin: socket.handshake.headers.origin,
      userAgent: socket.handshake.headers["user-agent"]?.substring(0, 50),
    });
    console.log(`📋 Auth data:`, socket.handshake.auth);

    const clientType = detectClientType(socket);
    console.log(`📱 Detected client type: ${clientType}`);

    let user;
    if (clientType === "web") {
      user = await authenticateWebClient(socket);
    } else if (clientType === "mobile") {
      user = await authenticateMobileClient(socket);
    } else {
      throw new Error("Unknown client type");
    }

    // Attach user to socket
    socket.user = user;
    socket.clientType = clientType;
    socket.isAuthenticated = true;
    socket.authenticatedAt = new Date();

    console.log(
      `✅ ${clientType} user ${user.userId} (${user.userType}) authenticated`,
    );

    next();
  } catch (error) {
    console.error(
      `❌ Socket authentication failed for ${socket.id}:`,
      error.message,
    );
    console.error(`❌ Stack:`, error.stack);
    next(new Error(`Authentication failed: ${error.message}`));
  }
}

/**
 * Validate room access for clients
 */
async function validateRoomAccess(clientId, chatGroupId) {
  try {
    const { data: chatGroup, error } = await supabase
      .from("chat_group")
      .select("client_id, sys_user_id, status")
      .eq("chat_group_id", chatGroupId)
      .single();

    if (error || !chatGroup) {
      throw new Error("Chat group not found");
    }

    if (chatGroup.client_id !== clientId) {
      throw new Error(
        "Access denied: client not authorized for this chat group",
      );
    }

    return true;
  } catch (error) {
    throw new Error("Room access validation failed: " + error.message);
  }
}

module.exports = {
  authenticateSocket,
  validateRoomAccess,
  detectClientType,
  authenticateWebClient,
  authenticateMobileClient,
};
