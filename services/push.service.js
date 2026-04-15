const supabase = require('../helpers/supabaseClient');
const { sendPushNotification } = require('../helpers/webPush');

/**
 * Upsert a push subscription for a user.
 * Each endpoint is unique — re-subscribing updates keys.
 */
async function saveSubscription(sysUserId, subscription) {
  const { endpoint, keys: { p256dh, auth } } = subscription;

  const { error } = await supabase
    .from('push_subscription')
    .upsert(
      { sys_user_id: sysUserId, endpoint, p256dh, auth },
      { onConflict: 'endpoint' }
    );

  if (error) throw error;
}

/**
 * Delete a push subscription by endpoint (called on unsubscribe / logout).
 */
async function deleteSubscription(endpoint) {
  const { error } = await supabase
    .from('push_subscription')
    .delete()
    .eq('endpoint', endpoint);

  if (error) throw error;
}

/**
 * Fetch all push subscriptions for a given agent.
 */
async function getSubscriptionsForUser(sysUserId) {
  const { data, error } = await supabase
    .from('push_subscription')
    .select('endpoint, p256dh, auth')
    .eq('sys_user_id', sysUserId);
  
  if (error) throw error;
  return data || [];
}

/**
 * Send a push notification to all subscriptions belonging to an agent.
 * Stale (410/404) subscriptions are deleted automatically.
 */
async function sendToUser(sysUserId, title, body, data = {}) {
  console.log(`🔔 sendToUser called for user ${sysUserId}:`, { title, body, data });
  
  let subscriptions;
  try {
    subscriptions = await getSubscriptionsForUser(sysUserId);
    console.log(`📋 Found ${subscriptions.length} subscription(s) for user ${sysUserId}`);
  } catch (err) {
    console.error(`❌ push.service: failed to fetch subscriptions for user ${sysUserId}:`, err.message);
    return;
  }

  if (!subscriptions.length) {
    console.warn(`⚠️ No push subscriptions found for user ${sysUserId}`);
    return;
  }

  const payload = { title, body, data };

  await Promise.all(
    subscriptions.map(async (sub) => {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      const result = await sendPushNotification(subscription, payload);
      if (result.stale) {
        await deleteSubscription(sub.endpoint).catch(() => {});
        console.log(`🗑️ push.service: removed stale subscription for user ${sysUserId}`);
      }
    })
  );
}

module.exports = { saveSubscription, deleteSubscription, getSubscriptionsForUser, sendToUser };
