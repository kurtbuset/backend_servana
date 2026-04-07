/**
 * Validates that all required environment variables are set before the server starts.
 * Call this early in index.js — before any module reads from process.env.
 */
function validateEnv() {
  const required = [
    'REACT_SUPABASE_URL',
    'REACT_SERVICE_ROLE_KEY',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
  ];

  const missing = required.filter((key) => !process.env[key]?.trim());

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach((key) => console.error(`   - ${key}`));
    console.error('\nCopy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

module.exports = { validateEnv };
