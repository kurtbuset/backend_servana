const express = require('express');
const AnalyticsService = require('../services/analytics.service');
const getCurrentUser = require('../middleware/getCurrentUser');

/**
 * Analytics Controller
 * Handles HTTP requests for analytics endpoints
 */
class AnalyticsController {
  getRouter() {
    const router = express.Router();

    // Add logging middleware for debugging
    router.use((req, res, next) => {
      console.log(`📊 Analytics API: ${req.method} ${req.path}`, req.query);
      next();
    });

    // Test route without authentication
    router.get('/test', (req, res) => {
      res.json({ 
        message: 'Analytics controller is working!',
        timestamp: new Date().toISOString()
      });
    });

    // Dashboard stats without auth for testing
    router.get('/dashboard-stats-test', (req, res) => this.getDashboardStats(req, res));

    // All routes require authentication
    router.get('/messages', getCurrentUser, (req, res) => this.getMessageAnalytics(req, res));
    router.get('/response-time', getCurrentUser, (req, res) => this.getResponseTimeAnalytics(req, res));
    router.get('/enhanced-response-time', getCurrentUser, (req, res) => this.getEnhancedResponseTimeAnalytics(req, res));
    router.get('/agent-performance', getCurrentUser, (req, res) => this.getAgentPerformanceAnalytics(req, res));
    router.get('/customer-satisfaction', getCurrentUser, (req, res) => this.getCustomerSatisfactionAnalytics(req, res));
    router.get('/top-conversations', getCurrentUser, (req, res) => this.getTopConversations(req, res));
    router.get('/department-rankings', getCurrentUser, (req, res) => this.getDepartmentRankings(req, res));
    router.get('/dashboard-stats', getCurrentUser, (req, res) => this.getDashboardStats(req, res));
    router.post('/recalculate-response-times', getCurrentUser, (req, res) => this.recalculateResponseTimes(req, res));

    return router;
  }

  /**
   * Get message analytics
   * GET /api/analytics/messages?period=weekly&agentOnly=true
   */
  async getMessageAnalytics(req, res) {
    try {
      const { period = 'weekly', agentOnly = 'false', date, week, month, year } = req.query;
      
      // Validate period
      const validPeriods = ['daily', 'weekly', 'monthly', 'yearly'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          success: false,
          message: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
        });
      }

      // Determine if we should filter by current agent
      const agentId = agentOnly === 'true' ? req.userId : null;

      // Pass date/week/month/year parameters to service
      const dateParams = {};
      if (period === 'daily' && date) {
        dateParams.date = date;
      } else if (period === 'weekly' && week) {
        dateParams.week = week;
      } else if (period === 'monthly' && month) {
        dateParams.month = month;
      } else if (period === 'yearly' && year) {
        dateParams.year = year;
      }

      const data = await AnalyticsService.getMessageAnalytics(period, agentId, dateParams);
      
      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error in getMessageAnalytics:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch message analytics'
      });
    }
  }

  /**
   * Get response time analytics
   * GET /api/analytics/response-time?period=weekly
   */
  async getResponseTimeAnalytics(req, res) {
    try {
      const { period = 'weekly', date, week, month, year } = req.query;
      
      // Validate period
      const validPeriods = ['daily', 'weekly', 'monthly', 'yearly'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          success: false,
          message: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
        });
      }

      // Pass date/week/month/year parameters to service
      const dateParams = {};
      if (period === 'daily' && date) {
        dateParams.date = date;
      } else if (period === 'weekly' && week) {
        dateParams.week = week;
      } else if (period === 'monthly' && month) {
        dateParams.month = month;
      } else if (period === 'yearly' && year) {
        dateParams.year = year;
      }

      const data = await AnalyticsService.getResponseTimeAnalytics(period, dateParams);
      
      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error in getResponseTimeAnalytics:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch response time analytics'
      });
    }
  }

  /**
   * Get enhanced response time analytics using ART formula
   * GET /api/analytics/enhanced-response-time?period=weekly
   */
  async getEnhancedResponseTimeAnalytics(req, res) {
    try {
      const { period = 'weekly', date, week, month, year } = req.query;
      
      // Validate period
      const validPeriods = ['daily', 'weekly', 'monthly', 'yearly'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          success: false,
          message: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
        });
      }

      // Pass date/week/month/year parameters to service
      const dateParams = {};
      if (period === 'daily' && date) {
        dateParams.date = date;
      } else if (period === 'weekly' && week) {
        dateParams.week = week;
      } else if (period === 'monthly' && month) {
        dateParams.month = month;
      } else if (period === 'yearly' && year) {
        dateParams.year = year;
      }

      const data = await AnalyticsService.getEnhancedResponseTimeAnalytics(period, dateParams);
      
      res.json({
        success: true,
        data,
        meta: {
          formula: 'ART = Total Response Time / Total Number of Responses',
          description: 'Comprehensive response time analytics tracking all agent responses'
        }
      });
    } catch (error) {
      console.error('Error in getEnhancedResponseTimeAnalytics:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch enhanced response time analytics'
      });
    }
  }

  /**
   * Get agent performance analytics
   * GET /api/analytics/agent-performance?sysUserId=123&period=weekly
   */
  async getAgentPerformanceAnalytics(req, res) {
    try {
      const { sysUserId, period = 'weekly', date, week, month, year } = req.query;
      
      // Validate period
      const validPeriods = ['daily', 'weekly', 'monthly', 'yearly'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          success: false,
          message: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
        });
      }

      // Pass date/week/month/year parameters to service
      const dateParams = {};
      if (period === 'daily' && date) {
        dateParams.date = date;
      } else if (period === 'weekly' && week) {
        dateParams.week = week;
      } else if (period === 'monthly' && month) {
        dateParams.month = month;
      } else if (period === 'yearly' && year) {
        dateParams.year = year;
      }

      const data = await AnalyticsService.getAgentPerformanceAnalytics(
        sysUserId ? parseInt(sysUserId) : null, 
        period,
        dateParams
      );
      
      res.json({
        success: true,
        data,
        meta: {
          period,
          sysUserId: sysUserId || 'all',
          totalAgents: data.length
        }
      });
    } catch (error) {
      console.error('Error in getAgentPerformanceAnalytics:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch agent performance analytics'
      });
    }
  }

  /**
   * Get customer satisfaction analytics
   * GET /api/analytics/customer-satisfaction?period=weekly&agentOnly=true
   */
  async getCustomerSatisfactionAnalytics(req, res) {
    try {
      const { period = 'weekly', agentOnly = 'false', date, week, month, year } = req.query;
      
      // Validate period
      const validPeriods = ['daily', 'weekly', 'monthly', 'yearly'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          success: false,
          message: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
        });
      }

      // Determine if we should filter by current agent
      const agentId = agentOnly === 'true' ? req.userId : null;

      // Pass date/week/month/year parameters to service
      const dateParams = {};
      if (period === 'daily' && date) {
        dateParams.date = date;
      } else if (period === 'weekly' && week) {
        dateParams.week = week;
      } else if (period === 'monthly' && month) {
        dateParams.month = month;
      } else if (period === 'yearly' && year) {
        dateParams.year = year;
      }

      const data = await AnalyticsService.getCustomerSatisfactionAnalytics(period, agentId, dateParams);
      
      res.json({
        success: true,
        data,
        meta: {
          period,
          agentId,
          description: 'Customer satisfaction ratings based on chat feedback'
        }
      });
    } catch (error) {
      console.error('Error in getCustomerSatisfactionAnalytics:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch customer satisfaction analytics'
      });
    }
  }

  /**
   * Get top conversations (frequent clients) for current agent
   * GET /api/analytics/top-conversations?period=weekly&limit=5
   */
  async getTopConversations(req, res) {
    try {
      const { period = 'weekly', limit = 5 } = req.query;
      
      // Validate period
      const validPeriods = ['daily', 'weekly', 'monthly', 'yearly'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          success: false,
          message: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
        });
      }

      // Validate limit
      const limitNum = parseInt(limit);
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 20) {
        return res.status(400).json({
          success: false,
          message: 'Limit must be a number between 1 and 20'
        });
      }

      // Use current user's ID as agent ID
      const agentId = req.userId;

      const data = await AnalyticsService.getTopConversations(agentId, period, limitNum);
      
      res.json({
        success: true,
        data,
        meta: {
          period,
          agentId,
          limit: limitNum,
          description: 'Top conversations showing most frequent clients for this agent'
        }
      });
    } catch (error) {
      console.error('Error in getTopConversations:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch top conversations'
      });
    }
  }

  /**
   * Get department rankings based on ratings
   * GET /api/analytics/department-rankings?departmentId=1&period=weekly&limit=5
   */
  async getDepartmentRankings(req, res) {
    try {
      const { departmentId, period = 'weekly', limit = 5 } = req.query;
      
      // Validate department ID
      if (!departmentId) {
        return res.status(400).json({
          success: false,
          message: 'Department ID is required'
        });
      }

      const deptId = parseInt(departmentId);
      if (isNaN(deptId)) {
        return res.status(400).json({
          success: false,
          message: 'Department ID must be a valid number'
        });
      }

      // Validate period
      const validPeriods = ['daily', 'weekly', 'monthly', 'yearly'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          success: false,
          message: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
        });
      }

      // Validate limit
      const limitNum = parseInt(limit);
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 20) {
        return res.status(400).json({
          success: false,
          message: 'Limit must be a number between 1 and 20'
        });
      }

      const data = await AnalyticsService.getDepartmentRankings(deptId, period, limitNum);
      
      res.json({
        success: true,
        data,
        meta: {
          departmentId: deptId,
          period,
          limit: limitNum,
          description: 'Agent rankings within department based on customer satisfaction ratings'
        }
      });
    } catch (error) {
      console.error('Error in getDepartmentRankings:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch department rankings'
      });
    }
  }

  /**
   * Get dashboard statistics
   * GET /api/analytics/dashboard-stats
   */
  async getDashboardStats(req, res) {
    try {
      const { date, week, month, year } = req.query;
      
      // Pass date/week/month/year parameters to service
      const dateParams = {};
      if (date) {
        dateParams.date = date;
      } else if (week) {
        dateParams.week = week;
      } else if (month) {
        dateParams.month = month;
      } else if (year) {
        dateParams.year = year;
      }

      const data = await AnalyticsService.getDashboardStats(dateParams);
      
      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error in getDashboardStats:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch dashboard statistics'
      });
    }
  }

  /**
   * Recalculate response times for existing data
   * POST /api/analytics/recalculate-response-times
   */
  async recalculateResponseTimes(req, res) {
    try {
      const { data, error } = await require('../helpers/supabaseClient').supabase
        .rpc('recalculate_all_response_times');

      if (error) throw error;

      res.json({
        success: true,
        message: data || 'Response times recalculated successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error in recalculateResponseTimes:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to recalculate response times'
      });
    }
  }
}

module.exports = new AnalyticsController();