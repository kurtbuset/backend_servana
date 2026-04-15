const webpush = require('web-push');

// Validate VAPID configuration
if (!process.env.VAPID_MAILTO || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.error('❌ VAPID keys not configured! Push notifications will not work.');
  console.error('Missing:', {
    VAPID_MAILTO: !process.env.VAPID_MAILTO,
    VAPID_PUBLIC_KEY: !process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: !process.env.VAPID_PRIVATE_KEY
  });
} else {
  console.log('✅ VAPID keys configured');
}

webpush.setVapidDetails(
  process.env.VAPID_MAILTO,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Send a push notification to a single subscription endpoint.
 * Returns true on success, false if subscription is stale (410/404).
 */
async function sendPushNotification(subscription, payload) {
  console.log('📤 Attempting to send push notification:', {
    title: payload.title,
    endpoint: subscription.endpoint?.substring(0, 50) + '...'
  });

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    console.log('✅ Push notification sent successfully');
    return { sent: true };
  } catch (err) {
    // Log detailed error information
    console.error('❌ Push send error:', {
      message: err.message,
      statusCode: err.statusCode,
      body: err.body,
      endpoint: subscription.endpoint?.substring(0, 50) + '...'
    });

    // Stale subscription - remove it
    if (err.statusCode === 410 || err.statusCode === 404) {
      return { sent: false, stale: true };
    }

    // Invalid VAPID keys or subscription
    if (err.statusCode === 400 || err.statusCode === 401 || err.statusCode === 403) {
      console.error('⚠️ Possible VAPID key mismatch or invalid subscription');
      return { sent: false, stale: true }; // Treat as stale to remove bad subscription
    }

    return { sent: false, stale: false };
  }
}

module.exports = { sendPushNotification };
