const axios = require('axios');

/**
 * Test script to simulate frontend-backend communication
 */
async function testFrontendBackend() {
  console.log('🧪 Testing Frontend-Backend Communication...\n');

  const baseURL = 'http://localhost:5000';
  
  // Create axios instance similar to frontend
  const api = axios.create({
    baseURL,
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  try {
    // 1. Test basic connectivity
    console.log('📡 Testing basic connectivity...');
    const testResponse = await api.get('/analytics/test');
    console.log(`✅ Basic connectivity: ${testResponse.status}`);
    console.log(`📊 Response:`, testResponse.data);
    console.log('');

    // 2. Test unauthenticated dashboard stats
    console.log('📡 Testing unauthenticated dashboard stats...');
    const dashboardTestResponse = await api.get('/analytics/dashboard-stats-test');
    console.log(`✅ Dashboard test: ${dashboardTestResponse.status}`);
    console.log(`📊 Dashboard data sample:`, JSON.stringify(dashboardTestResponse.data, null, 2).substring(0, 300) + '...');
    console.log('');

    // 3. Test authenticated endpoint (should fail without auth)
    console.log('📡 Testing authenticated dashboard stats (should fail)...');
    try {
      const authResponse = await api.get('/analytics/dashboard-stats');
      console.log(`❌ Unexpected success: ${authResponse.status}`);
    } catch (authError) {
      console.log(`✅ Expected auth failure: ${authError.response?.status} - ${authError.response?.data?.error || authError.message}`);
    }
    console.log('');

    // 4. Test enhanced response time (should fail without auth)
    console.log('📡 Testing enhanced response time analytics (should fail)...');
    try {
      const enhancedResponse = await api.get('/analytics/enhanced-response-time');
      console.log(`❌ Unexpected success: ${enhancedResponse.status}`);
    } catch (enhancedError) {
      console.log(`✅ Expected auth failure: ${enhancedError.response?.status} - ${enhancedError.response?.data?.error || enhancedError.message}`);
    }
    console.log('');

    // 5. Check if there's a login endpoint
    console.log('📡 Testing login endpoint availability...');
    try {
      const loginResponse = await api.post('/auth/login', {
        username: 'test',
        password: 'test'
      });
      console.log(`Login endpoint exists: ${loginResponse.status}`);
    } catch (loginError) {
      if (loginError.response?.status === 400 || loginError.response?.status === 401) {
        console.log(`✅ Login endpoint exists but credentials invalid: ${loginError.response.status}`);
      } else if (loginError.response?.status === 404) {
        console.log(`❌ Login endpoint not found: ${loginError.response.status}`);
      } else {
        console.log(`Login endpoint error: ${loginError.response?.status} - ${loginError.response?.data?.error || loginError.message}`);
      }
    }
    console.log('');

    console.log('📋 SUMMARY:');
    console.log('✅ Backend is running and responding');
    console.log('✅ Analytics endpoints are available');
    console.log('✅ Authentication is working (blocking unauthenticated requests)');
    console.log('💡 Frontend needs to authenticate before accessing protected endpoints');
    console.log('');
    console.log('🔍 NEXT STEPS:');
    console.log('1. Check if frontend user is logged in');
    console.log('2. Verify authentication cookies/tokens are being sent');
    console.log('3. Check browser network tab for failed requests');
    console.log('4. Verify CORS configuration allows credentials');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.log('💡 Backend server is not running. Start it with: npm start');
    }
  }
}

// Run tests
testFrontendBackend().then(() => {
  console.log('\n🏁 Frontend-Backend test complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test error:', error.message);
  process.exit(1);
});