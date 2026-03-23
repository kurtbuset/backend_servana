const express = require('express');
const AnalyticsService = require('../services/analytics.service');
const { verifyToken } = require('../middleware/authMiddleware');

/**
 * Analytics Controller
 * Handles HTTP requests for analytics endpoints
 */
class AnalyticsController {
  getRouter() {
    const router = express.Router();

    // All routes require authentication
    router.get('/messages', verifyToken, (req, res) => this.getMessageAnalytics(req, res));
    router.get('/response-time', verifyToken, (req, res) => this.getResponseTimeAnalytics(req, res));
    router.get('/dashboard-stats', verifyToken, (req, res) => this.getDashboardStats(req, res));

    return router;
  }

  /**
   * Get message analytics
   * GET /api/analytics/messages?period=weekly
   */
  async getMessageAnalytics(req, res) {
    try {
      const { period = 'weekly' } = req.query;
      
      // Validate period
      const validPeriods = ['daily', 'weekly', 'monthly', 'yearly'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          error: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
        });
      }

      const data = await AnalyticsService.getMessageAnalytics(period);
      
      res.json({ data });
    } catch (error) {
      console.error('Error in getMessageAnalytics:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch message analytics' });
    }
  }

  /**
   * Get response time analytics
   * GET /api/analytics/response-time?period=weekly
   */
  async getResponseTimeAnalytics(req, res) {
    try {
      const { period = 'weekly' } = req.query;
      
      // Validate period
      const validPeriods = ['daily', 'weekly', 'monthly', 'yearly'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          error: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
        });
      }

      const data = await AnalyticsService.getResponseTimeAnalytics(period);
      
      res.json({ data });
    } catch (error) {
      console.error('Error in getResponseTimeAnalytics:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch response time analytics' });
    }
  }

  /**
   * Get dashboard statistics
   * GET /api/analytics/dashboard-stats
   */
  async getDashboardStats(req, res) {
    try {
      const data = await AnalyticsService.getDashboardStats();
      
      res.json({ data });
    } catch (error) {
      console.error('Error in getDashboardStats:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dashboard statistics' });
    }
  }
}

module.exports = new AnalyticsController();
