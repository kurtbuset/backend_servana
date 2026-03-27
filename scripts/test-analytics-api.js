const axios = require('axios');

/**
 * Test script to check analytics API endpoints
 */
async function testAnalyticsAPI() {
  console.log('🧪 Testing Analytics API endpoints...\n');

  const baseURL = 'http://localhost:5000';
  
  // Test endpoints without authentication first
  const testEndpoints = [
    '/analytics/test',
    '/analytics/dashboard-stats-test',
  ];

  for (const endpoint of testEndpoints) {
    try {
      console.log(`📡 Testing: ${endpoint}`);
      const response = await axios.get(`${baseURL}${endpoint}`);
      console.log(`✅ Status: ${response.status}`);
      console.log(`📊 Data:`, JSON.stringify(response.data, null, 2));
      console.log('');
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        console.log(`❌ Connection refused - server not running on port 3000`);
        console.log('💡 Start the server with: npm start or node index.js\n');
        return;
      } else {
        console.log(`❌ Error: ${error.response?.status || error.code}`);
        console.log(`📝 Message: ${error.response?.data?.error || error.message}`);
        console.log('');
      }
    }
  }

  // Test a few more endpoints that might need auth
  console.log('🔐 Testing endpoints that require authentication...');
  
  const authEndpoints = [
    '/analytics/dashboard-stats',
    '/analytics/enhanced-response-time',
  ];

  for (const endpoint of authEndpoints) {
    try {
      console.log(`📡 Testing: ${endpoint}`);
      const response = await axios.get(`${baseURL}${endpoint}`);
      console.log(`✅ Status: ${response.status}`);
      console.log(`📊 Data sample:`, JSON.stringify(response.data, null, 2).substring(0, 200) + '...');
      console.log('');
    } catch (error) {
      console.log(`❌ Error: ${error.response?.status || error.code}`);
      console.log(`📝 Message: ${error.response?.data?.error || error.message}`);
      console.log('');
    }
  }
}

// Run tests
testAnalyticsAPI().then(() => {
  console.log('🏁 API tests complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test error:', error.message);
  process.exit(1);
});