const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

console.log('🔍 Supabase Connection Diagnosis\n');

console.log('📋 Environment Variables:');
console.log('   REACT_SUPABASE_URL:', process.env.REACT_SUPABASE_URL);
console.log('   REACT_SERVICE_ROLE_KEY:', process.env.REACT_SERVICE_ROLE_KEY ? 'Present' : 'Missing');
console.log('   NODE_ENV:', process.env.NODE_ENV);

console.log('\n🌐 Testing Connection...');

async function testConnection() {
  try {
    // Test 1: Basic HTTP request to the URL
    console.log('\nTest 1: Basic HTTP connectivity');
    const url = process.env.REACT_SUPABASE_URL;
    
    if (!url) {
      console.log('❌ No Supabase URL found');
      return;
    }
    
    console.log(`   Testing: ${url}`);
    
    try {
      const response = await fetch(url);
      console.log(`✅ HTTP Response: ${response.status} ${response.statusText}`);
    } catch (fetchError) {
      console.log(`❌ HTTP Request failed: ${fetchError.message}`);
      
      if (fetchError.code === 'ECONNRESET' || fetchError.code === 'ECONNREFUSED') {
        console.log('\n💡 Possible Solutions:');
        console.log('   1. Start your local Supabase instance');
        console.log('   2. Check if Docker containers are running');
        console.log('   3. Verify the URL is correct');
        console.log('   4. Use localhost instead of container name');
      }
    }
    
    // Test 2: Supabase client creation
    console.log('\nTest 2: Supabase Client Creation');
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.REACT_SUPABASE_URL,
        process.env.REACT_SERVICE_ROLE_KEY
      );
      console.log('✅ Supabase client created successfully');
      
      // Test 3: Simple query
      console.log('\nTest 3: Database Query Test');
      const { data, error } = await supabase
        .from('sys_user')
        .select('count')
        .limit(1);
      
      if (error) {
        console.log(`❌ Query failed: ${error.message}`);
      } else {
        console.log('✅ Database query successful');
      }
      
    } catch (clientError) {
      console.log(`❌ Supabase client error: ${clientError.message}`);
    }
    
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
  }
}

// Check if running in Docker
console.log('\n🐳 Environment Check:');
console.log('   Running in Docker:', process.env.DOCKER ? 'Yes' : 'No');
console.log('   Platform:', process.platform);

testConnection().then(() => {
  console.log('\n📋 Diagnosis Complete');
});