const supabase = require("../helpers/supabaseClient");
const jwtUtils = require("../utils/jwt");

/**
 * Simplified Socket Authentication Middleware
 * Handles both web (Authorization header) and mobile (JWT) authentication
 */

/**
 * Extract Bearer token from Authorization header or socket auth
 */
function extractBearerToken(socket) {
  // First, check socket.handshake.auth.token (Socket.IO native auth)
  if (socket.handshake.auth && socket.handshake.auth.token) {
    console.log('✅ Found token in socket.handshake.auth');
    return socket.handshake.auth.token;
  }

  // Then check Authorization header
  const authHeader = socket.handshake.headers.authorization;

  if (!authHeader) {
    throw new Error("No Authorization header or auth token found");
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

  // console.log('✅ Found token in Authorization header');
  return token;
}

/**
 * Detect client type based on headers
 */
function detectClientType(socket) {
  const headers = socket.handshake.headers;
  const auth = socket.handshake.auth;

  // Check for JWT in socket.handshake.auth (Socket.IO native auth)
  if (auth && auth.token) {
    // Try to decode to determine if it's a mobile client JWT
    try {
      const decoded = jwtUtils.verifyAccessToken(auth.token);
      if (decoded.client_id) {
        console.log('🔍 Detected mobile client (auth.token with client_id)');
        return "mobile";
      }
    } catch (err) {
      // Not a mobile JWT, might be Supabase token
    }
  }

  // Check for JWT in Authorization header
  if (headers.authorization && headers.authorization.startsWith("Bearer ")) {
    const token = headers.authorization.substring(7);
    try {
      const decoded = jwtUtils.verifyAccessToken(token);
      if (decoded.client_id) {
        console.log('🔍 Detected mobile client (Authorization header with client_id)');
        return "mobile";
      }
    } catch (err) {
      // Not a mobile JWT, assume web client with Supabase token
    }
    console.log('🔍 Detected web client (Authorization header)');
    return "web";
  }

  console.error('❌ No valid authentication method found');
  console.error('Headers:', JSON.stringify(headers, null, 2));
  console.error('Auth:', JSON.stringify(auth, null, 2));
  throw new Error("No valid authentication method found");
}

/**
 * Authenticate web client using Supabase token
 */
async function authenticateWebClient(socket) {
  const token = extractBearerToken(socket);

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

    const clientType = detectClientType(socket);

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
