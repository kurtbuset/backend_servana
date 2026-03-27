#!/usr/bin/env node

/**
 * Migration Script: Add transfer_type column to chat_transfer_log
 * 
 * This script adds the transfer_type column to track how transfers were initiated
 * 
 * Usage: node scripts/add-transfer-type.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../helpers/supabaseClient');

async function runMigration() {
  console.log('🚀 Starting transfer_type migration...\n');

  try {
    // Check if column already exists
    const { data: columns, error: columnError } = await supabase
      .rpc('get_columns', { table_name: 'chat_transfer_log' })
      .catch(() => ({ data: null, error: null }));

    console.log('📊 Checking if transfer_type column exists...\n');

    // Read migration file
    const migrationPath = path.join(__dirname, '../migrations/010_add_transfer_type.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded');
    console.log('📋 Migration SQL location:');
    console.log(`   ${migrationPath}\n`);

    console.log('⚠️  IMPORTANT: This migration must be executed through:');
    console.log('   1. Supabase Dashboard > SQL Editor');
    console.log('   2. Or using psql command line');
    console.log('   3. Or using a PostgreSQL client\n');

    console.log('📝 Migration will:');
    console.log('   1. Add transfer_type column to chat_transfer_log');
    console.log('   2. Add check constraint for valid values');
    console.log('   3. Set existing records to "manual" (default)');
    console.log('   4. Add column comment for documentation\n');

    // Check if any transfer logs exist
    const { data: transferLogs, error: countError } = await supabase
      .from('chat_transfer_log')
      .select('transfer_id', { count: 'exact', head: true });

    if (countError) {
      console.error('❌ Error checking transfer logs:', countError);
    } else {
      const count = transferLogs?.length || 0;
      console.log(`📊 Found ${count} existing transfer log records`);
      if (count > 0) {
        console.log(`   These will be updated to transfer_type = 'manual'\n`);
      }
    }

    console.log('✅ Migration preparation complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Copy the SQL from the migration file');
    console.log('   2. Run it in Supabase Dashboard > SQL Editor');
    console.log('   3. Verify the column was added');
    console.log('   4. Restart your backend server\n');

  } catch (error) {
    console.error('❌ Migration preparation failed:', error);
    process.exit(1);
  }
}

// Run migration
runMigration();
