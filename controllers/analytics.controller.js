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
    
    // Test ratings endpoint without auth
    router.get('/ratings-test', async (req, res) => {
      try {
        const supabase = require('../helpers/supabaseClient');
        const { data, error } = await supabase
          .from('chat_feedback')
          .select('rating, created_at')
          .not('rating', 'is', null)
          .limit(100);
        
        if (error) throw error;
        
        const totalRatings = data.length;
        const averageRating = totalRatings > 0 
          ? data.reduce((sum, f) => sum + f.rating, 0) / totalRatings 
          : 0;
        
        const ratingDistribution = {
          1: data.filter(f => f.rating === 1).length,
          2: data.filter(f => f.rating === 2).length,
          3: data.filter(f => f.rating === 3).length,
          4: data.filter(f => f.rating === 4).length,
          5: data.filter(f => f.rating === 5).length
        };
        
        res.json({
          success: true,
          data: {
            averageRating: Number(averageRating.toFixed(1)),
            totalRatings,
            ratingDistribution,
            sampleData: data.slice(0, 5)
          }
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Temporary test endpoint to verify frontend can reach backend
    router.get('/connection-test', (req, res) => {
      res.json({
        success: true,
        message: 'Frontend-Backend connection is working!',
        timestamp: new Date().toISOString(),
        serverPort: process.env.PORT || 5000,
        requestHeaders: {
          origin: req.headers.origin,
          host: req.headers.host,
          userAgent: req.headers['user-agent']
        }
      });
    });

    // All routes require authentication
    const getCurrentUser = require('../middleware/getCurrentUser');
    router.use(getCurrentUser);
    
    router.get('/messages', (req, res) => this.getMessageAnalytics(req, res));
    router.get('/response-time', (req, res) => this.getResponseTimeAnalytics(req, res));
    router.get('/enhanced-response-time', (req, res) => this.getEnhancedResponseTimeAnalytics(req, res));
    router.get('/agent-performance', (req, res) => this.getAgentPerformanceAnalytics(req, res));
    router.get('/agent-analytics/:agentId', (req, res) => this.getAgentAnalytics(req, res));
    router.get('/comprehensive-stats', (req, res) => this.getComprehensiveDashboardStats(req, res));
    router.get('/customer-satisfaction', (req, res) => this.getCustomerSatisfactionAnalytics(req, res));
    router.get('/top-conversations', (req, res) => this.getTopConversations(req, res));
    router.get('/department-rankings', (req, res) => this.getDepartmentRankings(req, res));
    router.get('/dashboard-stats', (req, res) => this.getDashboardStats(req, res));
    router.post('/recalculate-response-times', (req, res) => this.recalculateResponseTimes(req, res));

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
          error: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
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
      const { period = 'weekly', date, week, month, year } = req.query;
      
      // Validate period
      const validPeriods = ['daily', 'weekly', 'monthly', 'yearly'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          error: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
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
      
      res.json({ data });
    } catch (error) {
      console.error('Error in getResponseTimeAnalytics:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch response time analytics' });
    }
  }

  /**
   * Get enhanced response time analytics using ART formula
   * GET /api/analytics/enhanced-response-time?period=weekly
   */
  async getEnhancedResponseTimeAnalytics(req, res) {
    try {
      // Since the enhanced function is temporarily disabled, use the regular response time analytics
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

      // Use regular response time analytics as fallback
      const data = await AnalyticsService.getResponseTimeAnalytics(period, dateParams);
      
      res.json({
        success: true,
        data,
        meta: {
          formula: 'Using regular response time analytics (enhanced version temporarily disabled)',
          description: 'Response time analytics with fallback implementation'
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
      
      if (!agentId) {
        return res.status(401).json({
          success: false,
          message: 'User not authenticated'
        });
      }

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
      
      res.json({ data });
    } catch (error) {
      console.error('Error in getDashboardStats:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dashboard statistics' });
    }
  }

  /**
   * Recalculate response times for existing data
   * POST /api/analytics/recalculate-response-times
   */
  async recalculateResponseTimes(req, res) {
    try {
      console.log('🔄 Starting response time recalculation via API...');
      
      const responseTimeService = require('../services/responseTime.service');
      const result = await responseTimeService.recalculateAllResponseTimes();

      res.json({
        success: true,
        message: 'Response times recalculated successfully using backend logic',
        data: {
          processed: result.processed,
          updated: result.updated,
          skipped: result.processed - result.updated
        },
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

  /**
   * Get agent-specific analytics
   * GET /api/analytics/agent-analytics/:agentId
   */
  async getAgentAnalytics(req, res) {
    try {
      const { agentId } = req.params;
      const { period = 'weekly', date, week, month, year } = req.query;
      
      // Validate period
      const validPeriods = ['daily', 'weekly', 'monthly', 'yearly'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          error: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
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

      const data = await AnalyticsService.getAgentAnalytics(parseInt(agentId), period, dateParams);
      
      res.json({ data });
    } catch (error) {
      console.error('Error in getAgentAnalytics:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch agent analytics' });
    }
  }

  /**
   * Get comprehensive dashboard statistics
   * GET /api/analytics/comprehensive-stats
   */
  async getComprehensiveDashboardStats(req, res) {
    try {
      const { agentOnly = 'false', date, week, month, year } = req.query;
      
      // Determine if we should filter by current agent
      const agentId = agentOnly === 'true' ? req.userId : null;

      // Pass date/week/month/year parameters to service
      const dateParams = {};
      if (date) dateParams.date = date;
      if (week) dateParams.week = week;
      if (month) dateParams.month = month;
      if (year) dateParams.year = year;

      const data = await AnalyticsService.getComprehensiveDashboardStats(agentId, dateParams);
      
      res.json({ data });
    } catch (error) {
      console.error('Error in getComprehensiveDashboardStats:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch comprehensive dashboard stats' });
    }
  }
}

module.exports = new AnalyticsController();