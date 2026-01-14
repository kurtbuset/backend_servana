// supabase

const { createClient } = require('@supabase/supabase-js');
// Initialize Supabase client with environment variables

const supabase = createClient(
  process.env.REACT_SUPABASE_URL,
  process.env.REACT_SERVICE_ROLE_KEY
);

module.exports = supabase;  