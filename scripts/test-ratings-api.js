const axios = require('axios');

async function testRatingsAPI() {
  console.log('🔍 Testing ratings API endpoints...\n');

  const baseURL = process.env.API_URL || 'http://localhost:5000';
  
  // You'll need to replace this with a valid token from your browser
  const token = 'YOUR_ACCESS_TOKEN_HERE';

  try {
    // Test 1: Dashboard stats
    console.log('Test 1: Testing /api/analytics/dashboard-stats...');
    try {
      const response1 = await axios.get(`${baseURL}/api/analytics/dashboard-stats`, {
        headers: {
          'Cookie': `access_token=${token}`
        },
        params: {
          // No date params = all time
        }
      });
      console.log('✅ Dashboard stats response:', JSON.stringify(response1.data, null, 2));
    } catch (error) {
      console.error('❌ Dashboard stats error:', error.response?.data || error.message);
    }

    // Test 2: Customer satisfaction
    console.log('\nTest 2: Testing /api/analytics/customer-satisfaction...');
    try {
      const response2 = await axios.get(`${baseURL}/api/analytics/customer-satisfaction`, {
        headers: {
          'Cookie': `access_token=${token}`
        },
        params: {
          period: 'weekly',
          agentOnly: 'false'
        }
      });
      console.log('✅ Customer satisfaction response:', JSON.stringify(response2.data, null, 2));
    } catch (error) {
      console.error('❌ Customer satisfaction error:', error.response?.data || error.message);
    }

    // Test 3: Test without auth (should fail)
    console.log('\nTest 3: Testing without authentication...');
    try {
      const response3 = await axios.get(`${baseURL}/api/analytics/dashboard-stats-test`);
      console.log('✅ Test endpoint response:', JSON.stringify(response3.data, null, 2));
    } catch (error) {
      console.error('❌ Test endpoint error:', error.response?.data || error.message);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

console.log('⚠️  NOTE: This script requires a valid access token.');
console.log('⚠️  Get it from your browser cookies after logging in.\n');

testRatingsAPI();
