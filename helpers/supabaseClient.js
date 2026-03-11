require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.REACT_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.REACT_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing Supabase credentials in .env');
}
else{
  console.log('Supabase credentials loaded successfully');
}

// Production-ready configuration with connection pooling
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  db: {
    pool: {
      min: 2,
      max: 10  // Adjust based on your Supabase plan (free tier: 60 connections)
    }
  },
  auth: {
    persistSession: false  // Server-side doesn't need session persistence
  },
  global: {
    headers: {
      'x-application-name': 'servana-backend'
    }
  }
});

module.exports = supabase;