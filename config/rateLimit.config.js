const rateLimit = require('express-rate-limit');

/**
 * Global rate limiter for all requests
 * Applies to all endpoints except those explicitly skipped
 */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute window
  max: 120,                   // 120 requests per minute per IP
  standardHeaders: true,      // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,       // Disable `X-RateLimit-*` headers
  message: { error: 'Too many requests, please slow down' },
  skip: (req) => req.path === '/health', // Don't rate limit health checks
});

/**
 * Strict rate limiter for authentication endpoints
 * Prevents brute force attacks on login/register
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,                     // 5 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
  skipSuccessfulRequests: true, // Don't count successful requests
});

/**
 * API rate limiter for general API endpoints
 * More restrictive than global limiter
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute window
  max: 60,                    // 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'API rate limit exceeded' },
});

/**
 * Lenient rate limiter for file uploads
 * Allows fewer requests but with longer processing time
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute window
  max: 10,                    // 10 uploads per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload requests, please wait' },
});

module.exports = {
  globalLimiter,
  authLimiter,
  apiLimiter,
  uploadLimiter,
};
