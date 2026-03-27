const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function cleanupRatingConflicts() {
  try {
    console.log('🧹 Starting rating system cleanup...');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, '../migrations/010_cleanup_rating_conflicts.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute the migration
    console.log('📝 Executing cleanup migration...');
    const { error } = await supabase.rpc('exec_sql', { sql: migrationSQL });
    
    if (error) {
      console.error('❌ Migration failed:', error);
      return false;
    }
    
    console.log('✅ Rating system cleanup completed successfully!');
    
    // Verify the cleanup
    console.log('🔍 Verifying cleanup...');
    
    // Check that chat_rating table is gone
    const { data: tables, error: tableError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'chat_rating');
    
    if (tableError) {
      console.warn('⚠️ Could not verify table cleanup:', tableError);
    } else if (tables && tables.length === 0) {
      console.log('✅ chat_rating table successfully removed');
    } else {
      console.warn('⚠️ chat_rating table still exists');
    }
    
    // Check that chat_feedback table exists
    const { data: feedbackTable, error: feedbackError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'chat_feedback');
    
    if (feedbackError) {
      console.warn('⚠️ Could not verify chat_feedback table:', feedbackError);
    } else if (feedbackTable && feedbackTable.length > 0) {
      console.log('✅ chat_feedback table exists and is ready');
    } else {
      console.warn('⚠️ chat_feedback table not found');
    }
    
    // Check chat_group columns
    const { data: columns, error: columnError } = await supabase
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'chat_group')
      .in('column_name', ['rating_status', 'resolved_at', 'feedback_id']);
    
    if (columnError) {
      console.warn('⚠️ Could not verify chat_group columns:', columnError);
    } else {
      const columnNames = columns.map(col => col.column_name);
      
      if (!columnNames.includes('rating_status')) {
        console.log('✅ rating_status column successfully removed from chat_group');
      } else {
        console.warn('⚠️ rating_status column still exists in chat_group');
      }
      
      if (columnNames.includes('resolved_at')) {
        console.log('✅ resolved_at column exists in chat_group');
      } else {
        console.warn('⚠️ resolved_at column missing from chat_group');
      }
      
      if (columnNames.includes('feedback_id')) {
        console.log('✅ feedback_id column exists in chat_group');
      } else {
        console.warn('⚠️ feedback_id column missing from chat_group');
      }
    }
    
    console.log('\n📋 Summary:');
    console.log('- Removed conflicting chat_rating table');
    console.log('- Removed rating_status column from chat_group');
    console.log('- Ensured proper chat_feedback system is in place');
    console.log('- Your rating system now uses only chat_feedback table');
    
    return true;
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    return false;
  }
}

// Run the cleanup
cleanupRatingConflicts()
  .then(success => {
    if (success) {
      console.log('\n🎉 Rating system cleanup completed successfully!');
      process.exit(0);
    } else {
      console.log('\n💥 Rating system cleanup failed!');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });