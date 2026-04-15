const express = require('express');
const pushService = require('../services/push.service');
const getCurrentUser = require('../middleware/getCurrentUser');

class PushController {
  getRouter() {
    const router = express.Router();

    router.use(getCurrentUser);

    router.post('/subscribe', (req, res) => this.subscribe(req, res));
    router.delete('/subscribe', (req, res) => this.unsubscribe(req, res));

    return router;
  }

  async subscribe(req, res) {
    try {
      const sysUserId = req.userId;
      const subscription = req.body;

      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return res.status(400).json({ error: 'Invalid push subscription object' });
      }

      await pushService.saveSubscription(sysUserId, subscription);
      res.json({ data: { message: 'Push subscription saved' } });
    } catch (err) {
      console.error('❌ Error saving push subscription:', err.message);
      res.status(500).json({ error: 'Failed to save push subscription' });
    } 
  }

  async unsubscribe(req, res) {
    try {
      const { endpoint } = req.body;

      if (!endpoint) {
        return res.status(400).json({ error: 'endpoint is required' });
      }

      await pushService.deleteSubscription(endpoint);
      res.json({ data: { message: 'Push subscription removed' } });
    } catch (err) {
      console.error('❌ Error removing push subscription:', err.message);
      res.status(500).json({ error: 'Failed to remove push subscription' });
    }
  }
}

module.exports = new PushController();
