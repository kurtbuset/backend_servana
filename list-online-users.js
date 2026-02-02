/**
 * List all users and their online status from database
 * Usage: node list-online-users.js
 */

const supabase = require('./helpers/supabaseClient');

async function listUsers() {
  try {
    console.log('📋 Fetching all users from database...\n');
    
    const { data, error } = await supabase
      .from('sys_user')
      .select('sys_user_id, sys_user_fname, sys_user_lname, last_seen, sys_user_is_active')
      .order('last_seen', { ascending: false });
    
    if (error) {
      console.error('❌ Error fetching users:', error);
      return;
    }
    
    if (!data || data.length === 0) {
      console.log('❌ No users found in database');
      return;
    }
    
    console.log(`Found ${data.length} users:\n`);
    console.log('─'.repeat(100));
    console.log('ID'.padEnd(6) + 'Name'.padEnd(30) + 'Last Seen'.padEnd(35) + 'Status'.padEnd(15) + 'Active');
    console.log('─'.repeat(100));
    
    const now = new Date();
    
    data.forEach(user => {
      const userId = user.sys_user_id.toString().padEnd(6);
      const name = `${user.sys_user_fname} ${user.sys_user_lname}`.padEnd(30);
      const lastSeen = user.last_seen ? new Date(user.last_seen) : null;
      const lastSeenStr = lastSeen ? lastSeen.toLocaleString().padEnd(35) : 'Never'.padEnd(35);
      
      // Calculate time since last seen
      let statusStr = '';
      if (lastSeen) {
        const timeDiff = now - lastSeen;
        const seconds = Math.floor(timeDiff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (seconds < 45) {
          statusStr = '🟢 ONLINE';
        } else if (minutes < 5) {
          statusStr = `🟡 ${minutes}m ago`;
        } else if (hours < 1) {
          statusStr = `🟠 ${minutes}m ago`;
        } else if (hours < 24) {
          statusStr = `🔴 ${hours}h ago`;
        } else {
          const days = Math.floor(hours / 24);
          statusStr = `⚫ ${days}d ago`;
        }
      } else {
        statusStr = '⚫ Never';
      }
      
      const activeStr = user.sys_user_is_active ? '✅' : '❌';
      
      console.log(userId + name + lastSeenStr + statusStr.padEnd(15) + activeStr);
    });
    
    console.log('─'.repeat(100));
    console.log('\n📊 Summary:');
    
    const onlineCount = data.filter(u => {
      if (!u.last_seen) return false;
      const timeDiff = now - new Date(u.last_seen);
      return timeDiff < 45000; // 45 seconds
    }).length;
    
    const activeCount = data.filter(u => u.sys_user_is_active).length;
    
    console.log(`   Total Users: ${data.length}`);
    console.log(`   Active Accounts: ${activeCount}`);
    console.log(`   Currently Online: ${onlineCount}`);
    console.log(`   Inactive Accounts: ${data.length - activeCount}`);
    
    console.log('\n💡 To force a user offline:');
    console.log('   node force-user-offline.js <userId>');
    console.log('   Example: node force-user-offline.js 15');
    
  } catch (err) {
    console.error('❌ Error:', err);
  }
  
  process.exit(0);
}

listUsers();
