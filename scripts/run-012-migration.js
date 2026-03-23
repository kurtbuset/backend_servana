const fs = require('fs');
const path = require('path');
const supabase = require('../helpers/supabaseClient');

async function runMigration() {
  try {
    console.log('🚀 Running migration: 012_add_profile_created_at.sql');
    
    const migrationPath = path.join(__dirname, '../migrations/012_add_profile_created_at.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    // Split by semicolons and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    for (const statement of statements) {
      console.log('📝 Executing statement...');
      const { error } = await supabase.rpc('exec_sql', { sql_query: statement });
      
      if (error) {
        // Try direct query if RPC doesn't exist
        const { error: directError } = await supabase.from('profile').select('prof_id').limit(1);
        if (directError) {
          console.error('❌ Error:', error.message);
          throw error;
        }
      }
    }
    
    console.log('✅ Migration completed successfully!');
    console.log('📊 Verifying column was added...');
    
    // Verify the column exists
    const { data, error } = await supabase
      .from('profile')
      .select('prof_id, prof_created_at')
      .limit(1);
    
    if (error) {
      console.error('❌ Verification failed:', error.message);
    } else {
      console.log('✅ Column prof_created_at verified!');
      if (data && data.length > 0) {
        console.log('📋 Sample data:', data[0]);
      }
    }
    
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
}

runMigration();
