/**
 * Manual utility to force a user offline
 * Usage: node force-user-offline.js <userId>
 * Example: node force-user-offline.js 15
 */

const supabase = require('./helpers/supabaseClient');

async function forceUserOffline(userId) {
  try {
    console.log(`🔧 Forcing user ${userId} offline...`);
    
    // Update last_seen in database to current time
    const lastSeen = new Date().toISOString();
    const { data, error } = await supabase
      .from('sys_user')
      .update({ last_seen: lastSeen })
      .eq('sys_user_id', userId)
      .select();
    
    if (error) {
      console.error('❌ Error updating user:', error);
      return;
    }
    
    if (!data || data.length === 0) {
      console.error(`❌ User ${userId} not found in database`);
      return;
    }
    
    console.log('✅ Successfully updated last_seen for user:', userId);
    console.log('📅 Last seen set to:', lastSeen);
    console.log('👤 User data:', data[0]);
    console.log('\n⚠️ Note: The user will still show as online in the socket system until:');
    console.log('   1. The backend server is restarted with the fix, OR');
    console.log('   2. The stale user cleanup runs (every 60 seconds), OR');
    console.log('   3. The user logs in again and then logs out properly');
    
  } catch (err) {
    console.error('❌ Error:', err);
  }
  
  process.exit(0);
}

// Get userId from command line argument
const userId = parseInt(process.argv[2]);

if (!userId || isNaN(userId)) {
  console.error('❌ Usage: node force-user-offline.js <userId>');
  console.error('❌ Example: node force-user-offline.js 15');
  process.exit(1);
}

forceUserOffline(userId);
