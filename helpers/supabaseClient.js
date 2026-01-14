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


const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
module.exports = supabase;