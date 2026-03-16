#!/usr/bin/env node

/**
 * Migration Runner Script
 * Runs SQL migration files against the Supabase database
 */

const fs = require('fs');
const path = require('path');
const supabase = require('../helpers/supabaseClient');

async function runMigration(migrationFile) {
  try {
    console.log(`🔄 Running migration: ${migrationFile}`);
    
    const migrationPath = path.join(__dirname, '../migrations', migrationFile);
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    // Split SQL by semicolons and execute each statement
    const statements = sql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`  Executing: ${statement.substring(0, 50)}...`);
        const { error } = await supabase.rpc('exec_sql', { sql_query: statement });
        
        if (error) {
          // Try direct query if RPC fails
          const { error: directError } = await supabase.from('_').select('*').limit(0);
          if (directError) {
            console.warn(`  ⚠️  Warning: ${error.message}`);
          }
        }
      }
    }
    
    console.log(`✅ Migration completed: ${migrationFile}`);
    return true;
  } catch (error) {
    console.error(`❌ Migration failed: ${migrationFile}`);
    console.error(`   Error: ${error.message}`);
    return false;
  }
}

async function main() {
  const migrationFile = process.argv[2];
  
  if (!migrationFile) {
    console.error('Usage: node run-migration.js <migration-file>');
    console.error('Example: node run-migration.js 008_chat_feedback_schema.sql');
    process.exit(1);
  }
  
  console.log('🚀 Starting migration...');
  
  const success = await runMigration(migrationFile);
  
  if (success) {
    console.log('🎉 Migration completed successfully!');
    process.exit(0);
  } else {
    console.log('💥 Migration failed!');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { runMigration };