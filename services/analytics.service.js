const { supabase } = require('../helpers/supabaseClient');

/**
 * Analytics Service
 * Handles all analytics data retrieval and calculations
 */
class AnalyticsService {
  /**
   * Get message analytics for specified period
   * @param {string} period - 'daily', 'weekly', 'monthly', 'yearly'
   * @returns {Object} Message analytics data
   */
  async getMessageAnalytics(period = 'weekly') {
    try {
      const { interval, dateFormat, labels } = this.getPeriodConfig(period);
      
      // Call database function
      const { data, error } = await supabase.rpc('get_message_analytics', {
        time_interval: interval,
        date_format: dateFormat
      });

      if (error) throw error;

      // Fill in missing dates with 0 counts
      const dataMap = {};
      data.forEach(item => {
        dataMap[item.label] = parseInt(item.count);
      });

      const values = labels.map(label => dataMap[label] || 0);
      const total = values.reduce((sum, val) => sum + val, 0);

      // Calculate trend (compare with previous period)
      const trend = await this.calculateTrend('messages', period, total);

      return {
        labels,
        values,
        total,
        trend
      };
    } catch (error) {
      console.error('Error in getMessageAnalytics:', error);
      throw error;
    }
  }

  /**
   * Get response time analytics for specified period
   * @param {string} period - 'daily', 'weekly', 'monthly', 'yearly'
   * @returns {Object} Response time analytics data
   */
  async getResponseTimeAnalytics(period = 'weekly') {
    try {
      const { interval, dateFormat, labels } = this.getPeriodConfig(period);
      
      const { data, error } = await supabase.rpc('get_response_time_analytics', {
        time_interval: interval,
        date_format: dateFormat
      });

      if (error) throw error;

      // Fill in missing dates with null
      const dataMap = {};
      data.forEach(item => {
        dataMap[item.label] = parseFloat(item.avg_minutes);
      });

      const values = labels.map(label => dataMap[label] || 0);
      const average = values.reduce((sum, val) => sum + val, 0) / values.filter(v => v > 0).length;

      // Calculate trend
      const trend = await this.calculateTrend('response_time', period, average);

      return {
        labels,
        values,
        average: average.toFixed(1),
        trend
      };
    } catch (error) {
      console.error('Error in getResponseTimeAnalytics:', error);
      throw error;
    }
  }

  /**
   * Get dashboard statistics
   * @returns {Object} Dashboard stats
   */
  async getDashboardStats() {
    try {
      // Get all stats in parallel
      const [
        activeChatsResult,
        pendingChatsResult,
        resolvedTodayResult,
        activeAgentsResult,
        totalChatsResult,
        avgResponseResult
      ] = await Promise.all([
        // Active chats
        supabase
          .from('chat_group')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'active'),
        
        // Pending chats
        supabase
          .from('chat_group')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending'),
        
        // Resolved today
        supabase
          .from('chat_group')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'resolved')
          .gte('resolved_at', new Date().toISOString().split('T')[0]),
        
        // Active agents (check last_seen within last 5 minutes)
        supabase
          .from('sys_user')
          .select('*', { count: 'exact', head: true })
          .gte('last_seen', new Date(Date.now() - 5 * 60 * 1000).toISOString())
          .eq('sys_user_is_active', true),
        
        // Total chats
        supabase
          .from('chat_group')
          .select('*', { count: 'exact', head: true }),
        
        // Average response time
        supabase
          .from('chat_group')
          .select('response_time_minutes')
          .not('response_time_minutes', 'is', null)
      ]);

      // Calculate average response time
      let avgResponseTime = '0m';
      if (avgResponseResult.data && avgResponseResult.data.length > 0) {
        const sum = avgResponseResult.data.reduce((acc, item) => acc + (item.response_time_minutes || 0), 0);
        const avg = sum / avgResponseResult.data.length;
        avgResponseTime = avg < 60 ? `${avg.toFixed(1)}m` : `${(avg / 60).toFixed(1)}h`;
      }

      return {
        activeChats: activeChatsResult.count || 0,
        pendingChats: pendingChatsResult.count || 0,
        resolvedToday: resolvedTodayResult.count || 0,
        activeAgents: activeAgentsResult.count || 0,
        totalChats: totalChatsResult.count || 0,
        avgResponseTime
      };
    } catch (error) {
      console.error('Error in getDashboardStats:', error);
      throw error;
    }
  }

  /**
   * Get period configuration (interval, format, labels)
   * @param {string} period - 'daily', 'weekly', 'monthly', 'yearly'
   * @returns {Object} Period configuration
   */
  getPeriodConfig(period) {
    const configs = {
      daily: {
        interval: '1 day',
        dateFormat: 'HH24:00',
        labels: Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`)
      },
      weekly: {
        interval: '7 days',
        dateFormat: 'Dy',
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      },
      monthly: {
        interval: '30 days',
        dateFormat: 'DD',
        labels: Array.from({ length: 30 }, (_, i) => (i + 1).toString().padStart(2, '0'))
      },
      yearly: {
        interval: '1 year',
        dateFormat: 'Mon',
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      }
    };

    return configs[period] || configs.weekly;
  }

  /**
   * Calculate trend percentage compared to previous period
   * @param {string} metric - 'messages' or 'response_time'
   * @param {string} period - Time period
   * @param {number} currentValue - Current period value
   * @returns {string} Trend percentage (e.g., '+12%' or '-5%')
   */
  async calculateTrend(metric, period, currentValue) {
    try {
      const { interval } = this.getPeriodConfig(period);
      
      let query;
      if (metric === 'messages') {
        query = supabase
          .from('chat')
          .select('*', { count: 'exact', head: true })
          .gte('chat_created_at', new Date(Date.now() - 2 * this.intervalToMs(interval)).toISOString())
          .lt('chat_created_at', new Date(Date.now() - this.intervalToMs(interval)).toISOString());
      } else {
        query = supabase
          .from('chat_group')
          .select('response_time_minutes')
          .not('response_time_minutes', 'is', null)
          .gte('created_at', new Date(Date.now() - 2 * this.intervalToMs(interval)).toISOString())
          .lt('created_at', new Date(Date.now() - this.intervalToMs(interval)).toISOString());
      }

      const { data, count } = await query;
      
      let previousValue;
      if (metric === 'messages') {
        previousValue = count || 0;
      } else {
        previousValue = data && data.length > 0
          ? data.reduce((sum, item) => sum + (item.response_time_minutes || 0), 0) / data.length
          : 0;
      }

      if (previousValue === 0) return '+0%';
      
      const change = ((currentValue - previousValue) / previousValue) * 100;
      const sign = change >= 0 ? '+' : '';
      
      return `${sign}${Math.round(change)}%`;
    } catch (error) {
      console.error('Error calculating trend:', error);
      return '+0%';
    }
  }

  /**
   * Convert interval string to milliseconds
   * @param {string} interval - Interval string (e.g., '7 days')
   * @returns {number} Milliseconds
   */
  intervalToMs(interval) {
    const match = interval.match(/(\d+)\s+(\w+)/);
    if (!match) return 0;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    const units = {
      day: 24 * 60 * 60 * 1000,
      days: 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000
    };
    
    return value * (units[unit] || 0);
  }
}

module.exports = new AnalyticsService();
