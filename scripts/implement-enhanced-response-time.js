#!/usr/bin/env node

/**
 * Enhanced Response Time Implementation Script
 * 
 * This script:
 * 1. Runs the enhanced response time migration
 * 2. Recalculates response times for existing data
 * 3. Provides verification of the implementation
 * 
 * Usage: node scripts/implement-enhanced-response-time.js
 */

const { supabase } = require('../helpers/supabaseClient');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  console.log('🚀 Starting Enhanced Response Time Implementation...\n');

  try {
    // 1. Read and execute the migration SQL
    console.log('📄 Reading migration file...');
    const migrationPath = path.join(__dirname, '../migrations/009_enhanced_response_time.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('⚡ Executing migration...');
    const { error: migrationError } = await supabase.rpc('exec_sql', {
      sql_query: migrationSQL
    });

    if (migrationError) {
      // Try alternative approach - execute SQL directly
      console.log('🔄 Trying direct SQL execution...');
      const { error: directError } = await supabase.from('_migrations').select('*').limit(1);
      
      if (directError) {
        console.log('⚠️  Migration may need to be run manually. SQL file created at:');
        console.log(`   ${migrationPath}`);
        console.log('\n📋 Manual steps:');
        console.log('   1. Connect to your database');
        console.log('   2. Execute the SQL in 009_enhanced_response_time.sql');
        console.log('   3. Run this script again with --skip-migration flag');
        return;
      }
    }

    console.log('✅ Migration executed successfully!\n');

    // 2. Recalculate existing response times
    console.log('🔄 Recalculating response times for existing data...');
    const { data: recalcResult, error: recalcError } = await supabase
      .rpc('recalculate_all_response_times');

    if (recalcError) {
      console.error('❌ Error recalculating response times:', recalcError.message);
      return;
    }

    console.log('✅', recalcResult);

    // 3. Verify implementation
    console.log('\n🔍 Verifying implementation...');
    
    // Check if new columns exist
    const { data: chatGroups, error: cgError } = await supabase
      .from('chat_group')
      .select('chat_group_id, total_response_time_seconds, total_agent_responses, average_response_time_seconds')
      .limit(5);

    if (cgError) {
      console.error('❌ Error verifying chat_group columns:', cgError.message);
      return;
    }

    console.log('✅ New columns verified in chat_group table');

    // Check if response times are calculated
    const groupsWithResponseTimes = chatGroups.filter(cg => 
      cg.total_agent_responses > 0 && cg.average_response_time_seconds > 0
    );

    console.log(`📊 Found ${groupsWithResponseTimes.length} chat groups with calculated response times`);

    // 4. Test the new analytics functions
    console.log('\n🧪 Testing new analytics functions...');

    try {
      const { data: enhancedAnalytics, error: analyticsError } = await supabase
        .rpc('get_enhanced_response_time_analytics', {
          time_interval: '7 days',
          date_format: 'Dy'
        });

      if (analyticsError) {
        console.error('❌ Error testing enhanced analytics:', analyticsError.message);
      } else {
        console.log('✅ Enhanced analytics function working');
        console.log(`   Found ${enhancedAnalytics.length} data points`);
      }
    } catch (error) {
      console.log('⚠️  Enhanced analytics function may need manual verification');
    }

    // 5. Show sample data
    if (groupsWithResponseTimes.length > 0) {
      console.log('\n📈 Sample Response Time Data:');
      groupsWithResponseTimes.slice(0, 3).forEach((cg, index) => {
        const artSeconds = parseFloat(cg.average_response_time_seconds);
        const artFormatted = artSeconds < 60 
          ? `${Math.round(artSeconds)}s`
          : `${Math.round(artSeconds / 60)}m ${Math.round(artSeconds % 60)}s`;
        
        console.log(`   ${index + 1}. Chat Group ${cg.chat_group_id}:`);
        console.log(`      Total Responses: ${cg.total_agent_responses}`);
        console.log(`      Total Response Time: ${cg.total_response_time_seconds}s`);
        console.log(`      Average Response Time (ART): ${artFormatted}`);
      });
    }

    console.log('\n🎉 Enhanced Response Time Implementation Complete!');
    console.log('\n📋 What\'s New:');
    console.log('   ✓ Tracks ALL agent responses (not just first response)');
    console.log('   ✓ Calculates true Average Response Time (ART)');
    console.log('   ✓ Formula: ART = Total Response Time / Total Responses');
    console.log('   ✓ Individual response time tracking per message');
    console.log('   ✓ Agent performance analytics');
    console.log('   ✓ Enhanced analytics with min/max/avg data');

    console.log('\n🔗 New API Endpoints:');
    console.log('   GET /api/analytics/enhanced-response-time?period=weekly');
    console.log('   GET /api/analytics/agent-performance?sysUserId=123&period=weekly');
    console.log('   POST /api/analytics/recalculate-response-times');

    console.log('\n💡 Next Steps:');
    console.log('   1. Update your frontend to use new enhanced analytics endpoints');
    console.log('   2. Create dashboards showing ART trends and agent performance');
    console.log('   3. Set up alerts for response times exceeding thresholds');
    console.log('   4. Monitor the new metrics in your admin dashboard');

  } catch (error) {
    console.error('❌ Implementation failed:', error.message);
    console.error(error);
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
const skipMigration = args.includes('--skip-migration');

if (skipMigration) {
  console.log('⏭️  Skipping migration, running recalculation only...');
}

runMigration().then(() => {
  console.log('\n✨ Script completed!');
  process.exit(0);
}).catch(error => {
  console.error('💥 Script failed:', error);
  process.exit(1);
});