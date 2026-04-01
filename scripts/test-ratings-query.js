const supabase = require('../helpers/supabaseClient');

async function testRatingsQuery() {
  console.log('🔍 Testing ratings query...\n');

  try {
    // Test 1: Check if chat_feedback table has data
    console.log('Test 1: Checking chat_feedback table...');
    const { data: feedbackData, error: feedbackError, count } = await supabase
      .from('chat_feedback')
      .select('*', { count: 'exact' })
      .not('rating', 'is', null);

    if (feedbackError) {
      console.error('❌ Error querying chat_feedback:', feedbackError);
    } else {
      console.log(`✅ Found ${count} feedback records with ratings`);
      console.log('Sample data:', feedbackData?.slice(0, 3));
    }

    // Test 2: Check rating distribution
    console.log('\nTest 2: Checking rating distribution...');
    const { data: ratings, error: ratingsError } = await supabase
      .from('chat_feedback')
      .select('rating')
      .not('rating', 'is', null);

    if (ratingsError) {
      console.error('❌ Error getting ratings:', ratingsError);
    } else {
      const distribution = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0};
      ratings.forEach(r => {
        if (r.rating >= 1 && r.rating <= 5) {
          distribution[r.rating]++;
        }
      });
      console.log('✅ Rating distribution:', distribution);
      
      const totalRatings = ratings.length;
      const totalScore = ratings.reduce((sum, r) => sum + r.rating, 0);
      const averageRating = totalRatings > 0 ? totalScore / totalRatings : 0;
      console.log(`✅ Average rating: ${averageRating.toFixed(1)} (${totalRatings} total)`);
    }

    // Test 3: Check date filtering (last 7 days)
    console.log('\nTest 3: Checking ratings from last 7 days...');
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { data: recentFeedback, error: recentError } = await supabase
      .from('chat_feedback')
      .select('rating, created_at')
      .not('rating', 'is', null)
      .gte('created_at', sevenDaysAgo.toISOString());

    if (recentError) {
      console.error('❌ Error getting recent ratings:', recentError);
    } else {
      console.log(`✅ Found ${recentFeedback.length} ratings in last 7 days`);
      if (recentFeedback.length > 0) {
        const avgRecent = recentFeedback.reduce((sum, r) => sum + r.rating, 0) / recentFeedback.length;
        console.log(`✅ Average recent rating: ${avgRecent.toFixed(1)}`);
      }
    }

    // Test 4: Check chat_group linkage
    console.log('\nTest 4: Checking chat_group linkage...');
    const { data: linkedData, error: linkedError } = await supabase
      .from('chat_feedback')
      .select(`
        feedback_id,
        rating,
        chat_group_id,
        chat_group:chat_group_id (
          chat_group_id,
          sys_user_id,
          created_at
        )
      `)
      .not('rating', 'is', null)
      .limit(5);

    if (linkedError) {
      console.error('❌ Error checking linkage:', linkedError);
    } else {
      console.log('✅ Sample linked data:', JSON.stringify(linkedData, null, 2));
    }

    // Test 5: Simulate the analytics query
    console.log('\nTest 5: Simulating analytics service query...');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    
    const { data: analyticsData, error: analyticsError } = await supabase
      .from('chat_feedback')
      .select('rating, created_at, chat_group_id')
      .not('rating', 'is', null)
      .gte('created_at', startDate.toISOString())
      .limit(5000);

    if (analyticsError) {
      console.error('❌ Analytics query error:', analyticsError);
    } else {
      console.log(`✅ Analytics query returned ${analyticsData.length} records`);
      
      if (analyticsData.length > 0) {
        const totalRatings = analyticsData.length;
        const totalScore = analyticsData.reduce((sum, f) => sum + f.rating, 0);
        const averageRating = totalScore / totalRatings;
        
        const ratingDistribution = {
          1: analyticsData.filter(f => f.rating === 1).length,
          2: analyticsData.filter(f => f.rating === 2).length,
          3: analyticsData.filter(f => f.rating === 3).length,
          4: analyticsData.filter(f => f.rating === 4).length,
          5: analyticsData.filter(f => f.rating === 5).length
        };
        
        console.log('✅ Analytics result:');
        console.log('   Average Rating:', averageRating.toFixed(1));
        console.log('   Total Ratings:', totalRatings);
        console.log('   Distribution:', ratingDistribution);
      }
    }

    console.log('\n✅ All tests completed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testRatingsQuery();
