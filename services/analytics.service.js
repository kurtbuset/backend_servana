const supabase = require('../helpers/supabaseClient');

/**
 * Analytics Service
 * Handles all analytics data retrieval and calculations
 */
class AnalyticsService {
  /**
   * Apply date filtering to a query based on period and dateParams
   * @param {Object} query - Supabase query object
   * @param {string} period - Time period
   * @param {Object} dateParams - Date parameters
   * @param {string} dateColumn - Column name for date filtering (default: 'created_at')
   * @returns {Object} Modified query
   */
  applyDateFiltering(query, period, dateParams, dateColumn = 'created_at') {
    if (!query || typeof query.lte !== 'function') {
      console.error('Invalid query object passed to applyDateFiltering:', query);
      return query;
    }
    
    if (dateParams.date || dateParams.week || dateParams.month || dateParams.year) {
      const endDate = this.getEndDateForPeriod(period, dateParams);
      return query.lte(dateColumn, endDate.toISOString());
    }
    return query;
  }

  /**
   * Get agent's chat group IDs for filtering
   * @param {number} agentId - Agent ID
   * @returns {Promise<Array>} Array of chat group IDs
   */
  async getAgentChatGroupIds(agentId) {
    if (!agentId) return null;
    
    try {
      const { data: agentChatGroups, error } = await supabase
        .from('chat_group')
        .select('chat_group_id')
        .eq('sys_user_id', agentId)
        .limit(1000); // Add limit to prevent excessive data

      if (error) throw error;
      return agentChatGroups ? agentChatGroups.map(cg => cg.chat_group_id) : [];
    } catch (error) {
      console.error('Error in getAgentChatGroupIds:', error);
      return []; // Return empty array instead of throwing
    }
  }

  /**
   * Build a base chat group query with common filters
   * @param {Object} options - Query options
   * @returns {Object} Supabase query
   */
  buildChatGroupQuery(options = {}) {
    const { 
      select = '*', 
      agentId = null, 
      period = null, 
      dateParams = {}, 
      startDate = null,
      additionalFilters = {}
    } = options;

    let query = supabase.from('chat_group').select(select);

    // Apply agent filtering
    if (agentId) {
      query = query.eq('sys_user_id', agentId);
    }

    // Apply start date filtering
    if (startDate) {
      query = query.gte('created_at', startDate.toISOString());
    }

    // Apply end date filtering
    if (period && (dateParams.date || dateParams.week || dateParams.month || dateParams.year)) {
      query = this.applyDateFiltering(query, period, dateParams);
    }

    // Apply additional filters
    Object.entries(additionalFilters).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        query = query.eq(key, value);
      }
    });

    return query;
  }

  /**
   * Build a base chat/message query with common filters
   * @param {Object} options - Query options
   * @returns {Object} Supabase query
   */
  buildMessageQuery(options = {}) {
    const { 
      select = '*', 
      agentId = null, 
      chatGroupIds = null,
      period = null, 
      dateParams = {}, 
      startDate = null,
      additionalFilters = {}
    } = options;

    let query = supabase.from('chat').select(select);

    // Apply agent filtering
    if (agentId) {
      query = query.eq('sys_user_id', agentId);
    }

    // Apply chat group filtering
    if (chatGroupIds && chatGroupIds.length > 0) {
      query = query.in('chat_group_id', chatGroupIds);
    }

    // Apply start date filtering
    if (startDate) {
      query = query.gte('chat_created_at', startDate.toISOString());
    }

    // Apply end date filtering
    if (period && (dateParams.date || dateParams.week || dateParams.month || dateParams.year)) {
      query = this.applyDateFiltering(query, period, dateParams, 'chat_created_at');
    }

    // Apply additional filters
    Object.entries(additionalFilters).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        if (key === 'not_null') {
          query = query.not(value, 'is', null);
        } else {
          query = query.eq(key, value);
        }
      }
    });

    return query;
  }
  /**
   * Get message analytics for specified period
   * @param {string} period - 'daily', 'weekly', 'monthly', 'yearly'
   * @returns {Object} Message analytics data
   */
  async getMessageAnalytics(period = 'weekly', agentId = null, dateParams = {}) {
    try {
      const { interval, labels } = this.getPeriodConfig(period, dateParams);
      const startDate = this.getStartDateForPeriod(period, dateParams);
      
      // For agents, we want to show total messages from all time, not just the period
      let messageStartDate = startDate;
      if (agentId) {
        messageStartDate = new Date('2020-01-01'); // Use a very early date
      }
      
      // Get chat group IDs that have client inquiries
      const chatGroupIds = await this.getChatGroupsWithInquiries(agentId, messageStartDate);
      
      if (chatGroupIds.length === 0) {
        return this.getEmptyAnalyticsResult(labels, period, agentId);
      }

      // Get all messages from chat groups that have client inquiries
      let allMessagesQuery = supabase
        .from('chat')
        .select('chat_created_at, chat_group_id, client_id, sys_user_id')
        .in('chat_group_id', chatGroupIds)
        .gte('chat_created_at', messageStartDate.toISOString());

      // For chart data (period breakdown), use the original period dates
      let chartMessagesQuery = supabase
        .from('chat')
        .select('chat_created_at, chat_group_id, client_id, sys_user_id')
        .in('chat_group_id', chatGroupIds)
        .gte('chat_created_at', startDate.toISOString());

      // For specific date/week/month/year filtering on chart data, add end date constraint
      if (dateParams.date || dateParams.week || dateParams.month || dateParams.year) {
        const endDate = this.getEndDateForPeriod(period, dateParams);
        chartMessagesQuery = chartMessagesQuery.lte('chat_created_at', endDate.toISOString());
      }

      // If agentId is provided, only count messages from this agent (not client messages)
      if (agentId) {
        allMessagesQuery = allMessagesQuery.eq('sys_user_id', agentId);
        chartMessagesQuery = chartMessagesQuery.eq('sys_user_id', agentId);
      }

      const [{ data: allMessages, error: allError }, { data: chartMessages, error: chartError }] = await Promise.all([
        allMessagesQuery,
        chartMessagesQuery
      ]);

      if (allError) throw allError;
      if (chartError) throw chartError;

      // Process chart data by time periods
      const periodData = this.initializePeriodData(labels);
      chartMessages.forEach(message => {
        const messageDate = new Date(message.chat_created_at);
        const periodKey = this.formatDateForPeriod(messageDate, period, dateParams);
        
        if (periodData.hasOwnProperty(periodKey)) {
          periodData[periodKey]++;
        }
      });

      const chartData = {
        labels: labels,
        data: labels.map(label => periodData[label] || 0)
      };

      const totalMessages = allMessages.length;
      const chartPeriodTotal = chartMessages.length;
      const trend = await this.calculateTrend('messages', period, chartPeriodTotal, agentId);

      return {
        total: totalMessages,
        totalMessages,
        values: chartData.data,
        labels: chartData.labels,
        chartData,
        trend,
        growth: parseInt(trend.replace(/[+%]/g, '')) || 0,
        period,
        chatGroupsWithInquiries: chatGroupIds.length,
        agentId,
        allTimeTotal: totalMessages,
        periodTotal: chartPeriodTotal
      };
    } catch (error) {
      console.error('Error in getMessageAnalytics:', error);
      throw error;
    }
  }

  /**
   * Get chat groups with client inquiries
   * @param {number} agentId - Optional agent ID
   * @param {Date} startDate - Start date for filtering
   * @returns {Promise<Array>} Array of chat group IDs
   */
  async getChatGroupsWithInquiries(agentId, startDate) {
    let chatGroupQuery = supabase
      .from('chat')
      .select('chat_group_id')
      .not('client_id', 'is', null)
      .gte('chat_created_at', startDate.toISOString());

    if (agentId) {
      const agentChatGroupIds = await this.getAgentChatGroupIds(agentId);
      if (!agentChatGroupIds || agentChatGroupIds.length === 0) {
        return [];
      }
      chatGroupQuery = chatGroupQuery.in('chat_group_id', agentChatGroupIds);
    }

    const { data: chatGroupsWithInquiries, error } = await chatGroupQuery;
    if (error) throw error;

    return [...new Set(chatGroupsWithInquiries.map(item => item.chat_group_id))];
  }

  /**
   * Initialize period data object with zero values
   * @param {Array} labels - Period labels
   * @returns {Object} Initialized period data
   */
  initializePeriodData(labels) {
    const periodData = {};
    labels.forEach(label => {
      periodData[label] = 0;
    });
    return periodData;
  }

  /**
   * Get empty analytics result structure
   * @param {Array} labels - Period labels
   * @param {string} period - Time period
   * @param {number} agentId - Optional agent ID
   * @returns {Object} Empty analytics result
   */
  getEmptyAnalyticsResult(labels, period, agentId = null) {
    return {
      total: 0,
      totalMessages: 0,
      values: labels.map(() => 0),
      labels: labels,
      chartData: { labels, data: labels.map(() => 0) },
      trend: '+0%',
      growth: 0,
      period,
      chatGroupsWithInquiries: 0,
      agentId
    };
  }

  /**
   * Get enhanced response time analytics using comprehensive ART calculation
   * @param {string} period - 'daily', 'weekly', 'monthly', 'yearly'
   * @returns {Object} Enhanced response time analytics data
   * 
   * TODO: Fix the not_null filter issue in buildChatGroupQuery method
   * Currently commented out due to column 'chat_group.not_null' does not exist error
   * This function will be used later for response time analytics
   */
  /* 
  async getEnhancedResponseTimeAnalytics(period = 'weekly', dateParams = {}) {
    try {
      const { interval, labels } = this.getPeriodConfig(period, dateParams);
      const startDate = this.getStartDateForPeriod(period, dateParams);
      
      // Get chat groups with response time data using helper
      const query = this.buildChatGroupQuery({
        select: 'created_at, average_response_time_seconds, total_response_time_seconds, total_agent_responses',
        period,
        dateParams,
        startDate,
        additionalFilters: { not_null: 'average_response_time_seconds' }
      });

      const { data: chatGroups, error } = await query;
      if (error) throw error;

      // Process data by time periods using helper
      const periodData = this.initializeResponseTimePeriodData(labels);
      
      chatGroups.forEach(chat => {
        const chatDate = new Date(chat.created_at);
        const periodKey = this.formatDateForPeriod(chatDate, period, dateParams);
        
        if (periodData[periodKey]) {
          periodData[periodKey].totalResponseTime += chat.total_response_time_seconds || 0;
          periodData[periodKey].totalResponses += chat.total_agent_responses || 0;
          periodData[periodKey].chats.push(chat);
        }
      });

      // Calculate averages for chart
      const chartData = {
        labels: labels,
        data: labels.map(label => {
          const period = periodData[label];
          return period.totalResponses > 0 ? period.totalResponseTime / period.totalResponses : 0;
        })
      };

      // Calculate overall metrics
      const totalResponseTime = Object.values(periodData).reduce((sum, p) => sum + p.totalResponseTime, 0);
      const totalResponses = Object.values(periodData).reduce((sum, p) => sum + p.totalResponses, 0);
      const overallART = totalResponses > 0 ? totalResponseTime / totalResponses : 0;

      const trend = await this.calculateTrend('response_time', period, overallART);

      return {
        overallART,
        totalResponses,
        chartData,
        trend: parseInt(trend.replace(/[+%-]/g, '')) || 0,
        period,
        formatted: {
          overallART: this.formatTime(overallART)
        }
      };
    } catch (error) {
      console.error('Error in getEnhancedResponseTimeAnalytics:', error);
      throw error;
    }
  }
  */

  /**
   * Initialize response time period data structure
   * @param {Array} labels - Period labels
   * @returns {Object} Initialized period data
   */
  initializeResponseTimePeriodData(labels) {
    const periodData = {};
    labels.forEach(label => {
      periodData[label] = {
        totalResponseTime: 0,
        totalResponses: 0,
        chats: []
      };
    });
    return periodData;
  }

  /**
   * Get response time analytics using comprehensive chat_group data
   * @param {string} period - 'daily', 'weekly', 'monthly', 'yearly'
   * @param {Object} dateParams - Optional date parameters for daily analytics
   * @returns {Object} Response time analytics
   */
  async getResponseTimeAnalytics(period = 'weekly', dateParams = {}) {
    try {
      const { interval, labels } = this.getPeriodConfig(period, dateParams);
      const startDate = this.getStartDateForPeriod(period, dateParams);
      
      // Query chat groups with comprehensive response time data using helper
      const query = this.buildChatGroupQuery({
        select: `
          chat_group_id,
          created_at,
          first_response_at,
          response_time_minutes,
          average_response_time_seconds,
          total_response_time_seconds,
          total_agent_responses,
          sys_user_id,
          status
        `,
        period,
        dateParams,
        startDate
      });

      const { data: chatGroups, error } = await query;
      if (error) throw error;

      if (!chatGroups || chatGroups.length === 0) {
        return this.getEmptyResponseTimeResult(labels, period);
      }

      // Process data by time periods using helper
      const periodData = this.initializeDetailedResponseTimePeriodData(labels);
      
      // Calculate statistics
      let totalResponseTime = 0;
      let totalResponses = 0;
      let totalFirstResponseTime = 0;
      let chatGroupsWithFirstResponse = 0;

      chatGroups.forEach(chatGroup => {
        const createdDate = new Date(chatGroup.created_at);
        const periodKey = this.formatDateForPeriod(createdDate, period, dateParams);
        
        if (periodData[periodKey]) {
          periodData[periodKey].chatGroups += 1;
          
          // Add response time data if available
          if (chatGroup.total_response_time_seconds && chatGroup.total_agent_responses) {
            periodData[periodKey].totalResponseTime += chatGroup.total_response_time_seconds;
            periodData[periodKey].totalResponses += chatGroup.total_agent_responses;
            totalResponseTime += chatGroup.total_response_time_seconds;
            totalResponses += chatGroup.total_agent_responses;
          }
          
          // Add first response time data if available
          if (chatGroup.first_response_at && chatGroup.response_time_minutes) {
            periodData[periodKey].totalFirstResponseTime += chatGroup.response_time_minutes;
            periodData[periodKey].chatGroupsWithResponse += 1;
            totalFirstResponseTime += chatGroup.response_time_minutes;
            chatGroupsWithFirstResponse += 1;
          }
        }
      });

      // Calculate averages
      const averageResponseTime = totalResponses > 0 ? totalResponseTime / totalResponses : 0;
      const firstResponseAverage = chatGroupsWithFirstResponse > 0 ? 
        totalFirstResponseTime / chatGroupsWithFirstResponse : 0;

      // Calculate chart data (using average response time per period)
      const chartData = {
        labels: labels,
        data: labels.map(label => {
          const period = periodData[label];
          return period.totalResponses > 0 ? 
            Math.round(period.totalResponseTime / period.totalResponses) : 0;
        })
      };

      // Calculate trend
      const trend = await this.calculateTrend('response_time', period, averageResponseTime);

      return {
        average: Math.round(averageResponseTime * 100) / 100,
        averageResponseTime: averageResponseTime,
        firstResponseAverage: Math.round(firstResponseAverage * 60),
        totalResponses,
        totalChatGroups: chatGroups.length,
        chatGroupsWithResponse: chatGroupsWithFirstResponse,
        values: chartData.data,
        labels: chartData.labels,
        chartData,
        trend,
        growth: parseInt(trend.replace(/[+%-]/g, '')) || 0,
        period,
        type: 'enhanced',
        metrics: {
          averageResponseTimeSeconds: averageResponseTime,
          firstResponseTimeMinutes: firstResponseAverage,
          totalAgentResponses: totalResponses,
          totalChatGroups: chatGroups.length,
          responseRate: chatGroups.length > 0 ? 
            Math.round((chatGroupsWithFirstResponse / chatGroups.length) * 100) : 0
        },
        formatted: {
          averageResponseTime: this.formatTime(averageResponseTime),
          firstResponseAverage: this.formatTime(firstResponseAverage * 60),
          average: this.formatTime(averageResponseTime)
        }
      };
    } catch (error) {
      console.error('Error in getResponseTimeAnalytics:', error);
      throw error;
    }
  }

  /**
   * Initialize detailed response time period data structure
   * @param {Array} labels - Period labels
   * @returns {Object} Initialized period data
   */
  initializeDetailedResponseTimePeriodData(labels) {
    const periodData = {};
    labels.forEach(label => {
      periodData[label] = {
        totalResponseTime: 0,
        totalResponses: 0,
        totalFirstResponseTime: 0,
        chatGroupsWithResponse: 0,
        chatGroups: 0
      };
    });
    return periodData;
  }

  /**
   * Get empty response time analytics result
   * @param {Array} labels - Period labels
   * @param {string} period - Time period
   * @returns {Object} Empty response time result
   */
  getEmptyResponseTimeResult(labels, period) {
    return {
      average: 0,
      averageResponseTime: 0,
      firstResponseAverage: 0,
      totalResponses: 0,
      totalChatGroups: 0,
      values: labels.map(() => 0),
      labels: labels,
      chartData: { labels, data: labels.map(() => 0) },
      trend: '+0%',
      growth: 0,
      period,
      type: 'enhanced',
      formatted: { averageResponseTime: '0s', firstResponseAverage: '0m' }
    };
  }

  /**
   * Get agent-specific analytics using chat_group data
   * @param {number} agentId - Agent's sys_user_id
   * @param {string} period - 'daily', 'weekly', 'monthly', 'yearly'
   * @param {Object} dateParams - Optional date parameters
   * @returns {Object} Agent-specific analytics
   */
  async getAgentAnalytics(agentId, period = 'weekly', dateParams = {}) {
    try {
      const { interval, labels } = this.getPeriodConfig(period, dateParams);
      const startDate = this.getStartDateForPeriod(period, dateParams);

      // Query chat groups assigned to this agent using helper
      const chatGroupQuery = this.buildChatGroupQuery({
        select: `
          chat_group_id,
          created_at,
          first_response_at,
          resolved_at,
          ended_at,
          response_time_minutes,
          average_response_time_seconds,
          total_response_time_seconds,
          total_agent_responses,
          status,
          feedback_id
        `,
        agentId,
        period,
        dateParams,
        startDate
      });

      const { data: chatGroups, error } = await chatGroupQuery;
      if (error) throw error;

      if (!chatGroups || chatGroups.length === 0) {
        return this.getEmptyAgentAnalyticsResult(period, agentId);
      }

      // Get total messages sent by this agent in the period using helper
      const messageQuery = this.buildMessageQuery({
        select: 'chat_id',
        agentId,
        period,
        dateParams,
        startDate
      });

      const { count: totalMessages } = await messageQuery.select('*', { count: 'exact', head: true });

      // Calculate statistics using helper
      const stats = this.calculateAgentStatistics(chatGroups);
      const performanceRating = this.getPerformanceRating(stats.averageResponseTime);

      return {
        agentId,
        period,
        totalChats: stats.totalChats,
        resolvedChats: stats.resolvedChats,
        activeChats: stats.activeChats,
        endedChats: stats.endedChats,
        averageResponseTime: Math.round(stats.averageResponseTime),
        firstResponseAverage: Math.round(stats.firstResponseAverage * 60),
        totalMessages: totalMessages || 0,
        totalResponses: stats.totalResponses,
        resolutionRate: stats.resolutionRate,
        responseRate: stats.responseRate,
        performanceRating,
        metrics: {
          averageResponseTimeSeconds: stats.averageResponseTime,
          firstResponseTimeMinutes: stats.firstResponseAverage,
          totalAgentResponses: stats.totalResponses,
          chatGroupsWithResponse: stats.chatGroupsWithFirstResponse,
          totalChatGroups: stats.totalChats
        },
        formatted: {
          averageResponseTime: this.formatTime(stats.averageResponseTime),
          firstResponseAverage: this.formatTime(stats.firstResponseAverage * 60)
        }
      };

    } catch (error) {
      console.error('Error in getAgentAnalytics:', error);
      throw error;
    }
  }

  /**
   * Calculate agent statistics from chat groups
   * @param {Array} chatGroups - Array of chat group data
   * @returns {Object} Calculated statistics
   */
  calculateAgentStatistics(chatGroups) {
    const totalChats = chatGroups.length;
    const resolvedChats = chatGroups.filter(cg => cg.status === 'resolved').length;
    const activeChats = chatGroups.filter(cg => cg.status === 'active').length;
    const endedChats = chatGroups.filter(cg => cg.status === 'ended').length;

    // Calculate response time statistics
    const totalResponseTime = chatGroups.reduce((sum, cg) => sum + (cg.total_response_time_seconds || 0), 0);
    const totalResponses = chatGroups.reduce((sum, cg) => sum + (cg.total_agent_responses || 0), 0);
    const averageResponseTime = totalResponses > 0 ? totalResponseTime / totalResponses : 0;

    // Calculate first response time average
    const chatGroupsWithFirstResponse = chatGroups.filter(cg => cg.first_response_at && cg.response_time_minutes);
    const totalFirstResponseTime = chatGroupsWithFirstResponse.reduce((sum, cg) => sum + (cg.response_time_minutes || 0), 0);
    const firstResponseAverage = chatGroupsWithFirstResponse.length > 0 ? 
      totalFirstResponseTime / chatGroupsWithFirstResponse.length : 0;

    // Calculate rates
    const resolutionRate = totalChats > 0 ? Math.round((resolvedChats / totalChats) * 100) : 0;
    const responseRate = totalChats > 0 ? 
      Math.round((chatGroupsWithFirstResponse.length / totalChats) * 100) : 0;

    return {
      totalChats,
      resolvedChats,
      activeChats,
      endedChats,
      averageResponseTime,
      firstResponseAverage,
      totalResponses,
      resolutionRate,
      responseRate,
      chatGroupsWithFirstResponse: chatGroupsWithFirstResponse.length
    };
  }

  /**
   * Get empty agent analytics result
   * @param {string} period - Time period
   * @param {number} agentId - Agent ID
   * @returns {Object} Empty agent analytics result
   */
  getEmptyAgentAnalyticsResult(period, agentId) {
    return {
      totalChats: 0,
      resolvedChats: 0,
      activeChats: 0,
      averageResponseTime: 0,
      firstResponseAverage: 0,
      totalMessages: 0,
      resolutionRate: 0,
      period,
      agentId
    };
  }

  /**
   * Get agent performance analytics
   * @param {number} sysUserId - Optional specific sys_user_id
   * @param {string} period - Time period for analysis
   * @returns {Array} Agent performance data
   */
  async getAgentPerformanceAnalytics(sysUserId = null, period = 'weekly', dateParams = {}) {
    try {
      const { interval } = this.getPeriodConfig(period, dateParams);
      const startDate = this.getStartDateForPeriod(period, dateParams);
      
      // Build query using helper
      const query = this.buildChatGroupQuery({
        select: `
          sys_user_id,
          average_response_time_seconds,
          total_agent_responses,
          sys_user:sys_user_id (
            sys_user_id,
            profile:prof_id (
              prof_firstname,
              prof_lastname
            )
          )
        `,
        agentId: sysUserId,
        period,
        dateParams,
        startDate,
        additionalFilters: { 
          not_null: 'sys_user_id',
          'average_response_time_seconds': null // This will be handled specially
        }
      });

      // Apply the not null filter for average_response_time_seconds
      const finalQuery = query.not('average_response_time_seconds', 'is', null);
      const { data, error } = await finalQuery;
      if (error) throw error;

      // Group by agent and calculate performance metrics
      const agentData = this.groupAgentPerformanceData(data);
      
      // Calculate averages and performance ratings
      const agents = Object.values(agentData).map(agent => {
        const avgResponseTime = agent.total_responses > 0 
          ? agent.total_response_time / agent.total_responses 
          : 0;
        
        return {
          ...agent,
          avg_response_time_seconds: avgResponseTime,
          performance_rating: this.getPerformanceRating(avgResponseTime)
        };
      });

      return agents.sort((a, b) => a.avg_response_time_seconds - b.avg_response_time_seconds);
    } catch (error) {
      console.error('Error in getAgentPerformanceAnalytics:', error);
      throw error;
    }
  }

  /**
   * Group agent performance data by agent ID
   * @param {Array} data - Raw chat group data
   * @returns {Object} Grouped agent data
   */
  groupAgentPerformanceData(data) {
    const agentData = {};
    
    data.forEach(chat => {
      const agentId = chat.sys_user_id;
      if (!agentData[agentId]) {
        agentData[agentId] = {
          sys_user_id: agentId,
          agent_firstname: chat.sys_user?.profile?.prof_firstname || 'Unknown',
          agent_lastname: chat.sys_user?.profile?.prof_lastname || 'Agent',
          total_chats: 0,
          total_response_time: 0,
          total_responses: 0
        };
      }
      
      agentData[agentId].total_chats += 1;
      agentData[agentId].total_response_time += chat.average_response_time_seconds || 0;
      agentData[agentId].total_responses += chat.total_agent_responses || 0;
    });

    return agentData;
  }

  /**
   * Get customer satisfaction analytics based on chat ratings
   * @param {string} period - 'daily', 'weekly', 'monthly', 'yearly'
   * @param {number} agentId - Optional agent ID to filter by specific agent
   * @returns {Promise} Customer satisfaction data
   */
  async getCustomerSatisfactionAnalytics(period = 'weekly', agentId = null, dateParams = {}) {
    try {
      const { interval, labels } = this.getPeriodConfig(period, dateParams);
      const startDate = this.getStartDateForPeriod(period, dateParams);
      
      // Get feedback data with agent filtering if needed - with shorter timeout
      const feedbacks = await Promise.race([
        this.getFeedbackData(agentId, startDate, period, dateParams),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Feedback query timeout')), 10000)
        )
      ]);
      
      if (feedbacks.length === 0) {
        return this.getEmptySatisfactionResult(labels, period, agentId);
      }

      // Process data by time periods using helper
      const periodData = this.initializeSatisfactionPeriodData(labels);
      
      feedbacks.forEach(feedback => {
        const feedbackDate = new Date(feedback.created_at);
        const periodKey = this.formatDateForPeriod(feedbackDate, period, dateParams);
        
        if (periodData[periodKey]) {
          periodData[periodKey].totalRating += feedback.rating;
          periodData[periodKey].count += 1;
          periodData[periodKey].ratings.push(feedback.rating);
        }
      });

      // Calculate chart data and metrics
      const chartData = {
        labels: labels,
        data: labels.map(label => {
          const period = periodData[label];
          return period.count > 0 ? (period.totalRating / period.count) : 0;
        })
      };

      const metrics = this.calculateSatisfactionMetrics(feedbacks);
      
      // Skip trend calculation to avoid additional timeout - use simple fallback
      let trend = '+0%';
      try {
        trend = await Promise.race([
          this.calculateTrend('satisfaction', period, metrics.averageRating, agentId),
          new Promise((resolve) => 
            setTimeout(() => resolve('+0%'), 3000)
          )
        ]);
      } catch (trendError) {
        console.warn('Trend calculation failed, using fallback:', trendError.message);
        trend = '+0%';
      }

      return {
        averageRating: metrics.averageRating,
        totalRatings: metrics.totalRatings,
        satisfactionRate: metrics.satisfactionRate,
        ratingDistribution: metrics.ratingDistribution,
        values: chartData.data,
        labels: chartData.labels,
        chartData,
        trend,
        growth: parseInt(trend.replace(/[+%-]/g, '')) || 0,
        period,
        agentId,
        formatted: {
          averageRating: `${metrics.averageRating}/5.0`,
          satisfactionRate: `${metrics.satisfactionRate}%`
        }
      };
    } catch (error) {
      console.error('Error in getCustomerSatisfactionAnalytics:', error);
      
      // Return fallback data instead of throwing to prevent complete failure
      const { labels } = this.getPeriodConfig(period, dateParams);
      return this.getEmptySatisfactionResult(labels, period, agentId);
    }
  }

  /**
   * Get feedback data with optional agent filtering
   * @param {number} agentId - Optional agent ID
   * @param {Date} startDate - Start date
   * @param {string} period - Time period
   * @param {Object} dateParams - Date parameters
   * @returns {Promise<Array>} Feedback data
   */
  async getFeedbackData(agentId, startDate, period, dateParams) {
    try {
      let feedbackQuery = supabase
        .from('chat_feedback')
        .select('rating, created_at, chat_group_id')
        .not('rating', 'is', null)
        .gte('created_at', startDate.toISOString());

      // Apply date filtering
      feedbackQuery = this.applyDateFiltering(feedbackQuery, period, dateParams);

      // Filter by agent if specified - use a more efficient approach
      if (agentId) {
        // Instead of fetching all chat groups first, use a join query
        const { data: feedbackWithAgent, error: feedbackError } = await supabase
          .from('chat_feedback')
          .select(`
            rating,
            created_at,
            chat_group_id,
            chat_group!inner(sys_user_id)
          `)
          .not('rating', 'is', null)
          .gte('created_at', startDate.toISOString())
          .eq('chat_group.sys_user_id', agentId)
          .limit(1000);

        if (feedbackError) throw feedbackError;
        
        // Transform the data to match expected format
        return (feedbackWithAgent || []).map(f => ({
          rating: f.rating,
          created_at: f.created_at,
          chat_group_id: f.chat_group_id
        }));
      }

      // Add limit to prevent excessive data retrieval
      feedbackQuery = feedbackQuery.limit(1000);

      const { data: feedbacks, error } = await feedbackQuery;
      if (error) throw error;

      return feedbacks || [];
    } catch (error) {
      console.error('Error in getFeedbackData:', error);
      return []; // Return empty array instead of throwing to prevent cascade failures
    }
  }

  /**
   * Initialize satisfaction period data structure
   * @param {Array} labels - Period labels
   * @returns {Object} Initialized period data
   */
  initializeSatisfactionPeriodData(labels) {
    const periodData = {};
    labels.forEach(label => {
      periodData[label] = {
        totalRating: 0,
        count: 0,
        ratings: []
      };
    });
    return periodData;
  }

  /**
   * Calculate satisfaction metrics from feedback data
   * @param {Array} feedbacks - Feedback data
   * @returns {Object} Calculated metrics
   */
  calculateSatisfactionMetrics(feedbacks) {
    const totalRatings = feedbacks.length;
    const totalScore = feedbacks.reduce((sum, f) => sum + f.rating, 0);
    const averageRating = totalRatings > 0 ? totalScore / totalRatings : 0;

    // Calculate rating distribution
    const ratingDistribution = {
      1: feedbacks.filter(f => f.rating === 1).length,
      2: feedbacks.filter(f => f.rating === 2).length,
      3: feedbacks.filter(f => f.rating === 3).length,
      4: feedbacks.filter(f => f.rating === 4).length,
      5: feedbacks.filter(f => f.rating === 5).length
    };

    // Calculate satisfaction percentage (4-5 star ratings)
    const satisfiedCount = ratingDistribution[4] + ratingDistribution[5];
    const satisfactionRate = totalRatings > 0 ? (satisfiedCount / totalRatings) * 100 : 0;

    return {
      averageRating: Math.round(averageRating * 10) / 10,
      totalRatings,
      satisfactionRate: Math.round(satisfactionRate),
      ratingDistribution
    };
  }

  /**
   * Get empty satisfaction analytics result
   * @param {Array} labels - Period labels
   * @param {string} period - Time period
   * @param {number} agentId - Optional agent ID
   * @returns {Object} Empty satisfaction result
   */
  getEmptySatisfactionResult(labels, period, agentId) {
    return {
      averageRating: 0,
      totalRatings: 0,
      satisfactionRate: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      values: labels.map(() => 0),
      labels: labels,
      chartData: { labels, data: labels.map(() => 0) },
      trend: '+0%',
      growth: 0,
      period,
      agentId,
      formatted: {
        averageRating: '0.0/5.0',
        satisfactionRate: '0%'
      }
    };
  }

  /**
   * Get top conversations (frequent clients) for a specific agent
   * @param {number} agentId - Agent ID to get top conversations for
   * @param {string} period - 'daily', 'weekly', 'monthly', 'yearly'
   * @param {number} limit - Number of top clients to return (default: 5)
   * @returns {Promise} Top conversations data
   */
  async getTopConversations(agentId, period = 'weekly', limit = 5) {
    try {
      const { interval } = this.getPeriodConfig(period);
      const startDate = new Date(Date.now() - this.intervalToMs(interval));
      
      // Get chat groups handled by this agent with client information
      const { data: chatGroups, error } = await supabase
        .from('chat_group')
        .select(`
          chat_group_id,
          client_id,
          created_at,
          client:client_id (
            client_id,
            prof_id,
            profile:prof_id (
              prof_firstname,
              prof_lastname
            )
          )
        `)
        .eq('sys_user_id', agentId)
        .gte('created_at', startDate.toISOString());

      if (error) throw error;

      // Count messages per client in these chat groups
      const clientStats = {};
      
      for (const chatGroup of chatGroups) {
        if (!chatGroup.client || !chatGroup.client.profile) continue;
        
        const clientId = chatGroup.client_id;
        const clientName = `${chatGroup.client.profile.prof_firstname} ${chatGroup.client.profile.prof_lastname}`;
        
        // Get message count for this chat group
        const { data: messages, error: msgError } = await supabase
          .from('chat')
          .select('chat_id', { count: 'exact', head: true })
          .eq('chat_group_id', chatGroup.chat_group_id)
          .gte('chat_created_at', startDate.toISOString());

        if (msgError) continue;

        const messageCount = messages?.length || 0;

        if (!clientStats[clientId]) {
          clientStats[clientId] = {
            clientId,
            clientName,
            chatGroups: 0,
            totalMessages: 0,
            lastChatDate: chatGroup.created_at
          };
        }

        clientStats[clientId].chatGroups += 1;
        clientStats[clientId].totalMessages += messageCount;
        
        // Update last chat date if this one is more recent
        if (new Date(chatGroup.created_at) > new Date(clientStats[clientId].lastChatDate)) {
          clientStats[clientId].lastChatDate = chatGroup.created_at;
        }
      }

      // Convert to array and sort by total messages (most active first)
      const topClients = Object.values(clientStats)
        .sort((a, b) => b.totalMessages - a.totalMessages)
        .slice(0, limit)
        .map((client, index) => ({
          ...client,
          rank: index + 1,
          avgMessagesPerChat: client.chatGroups > 0 ? Math.round(client.totalMessages / client.chatGroups) : 0,
          lastChatDate: new Date(client.lastChatDate).toLocaleDateString()
        }));

      return {
        topClients,
        totalUniqueClients: Object.keys(clientStats).length,
        period,
        agentId,
        limit
      };
    } catch (error) {
      console.error('Error in getTopConversations:', error);
      throw error;
    }
  }

  /**
   * Get department rankings based on customer satisfaction ratings
   * @param {number} departmentId - Department ID to get rankings for
   * @param {string} period - 'daily', 'weekly', 'monthly', 'yearly'
   * @param {number} limit - Number of top agents to return (default: 5)
   * @returns {Promise} Department rankings data
   */
  async getDepartmentRankings(departmentId, period = 'weekly', limit = 5) {
    try {
      const { interval } = this.getPeriodConfig(period);
      const startDate = new Date(Date.now() - this.intervalToMs(interval));
      
      // Get agents in the department with their chat groups and ratings
      const { data: departmentAgents, error: agentsError } = await supabase
        .from('sys_user_department')
        .select(`
          sys_user_id,
          sys_user:sys_user_id (
            sys_user_id,
            prof_id,
            profile:prof_id (
              prof_firstname,
              prof_lastname
            )
          )
        `)
        .eq('dept_id', departmentId);

      if (agentsError) throw agentsError;

      const agentRankings = [];

      for (const deptAgent of departmentAgents) {
        if (!deptAgent.sys_user?.profile) continue;

        const agentId = deptAgent.sys_user_id;
        const agentName = `${deptAgent.sys_user.profile.prof_firstname} ${deptAgent.sys_user.profile.prof_lastname}`;

        // Get chat groups handled by this agent
        const { data: chatGroups, error: chatError } = await supabase
          .from('chat_group')
          .select('chat_group_id')
          .eq('sys_user_id', agentId)
          .gte('created_at', startDate.toISOString());

        if (chatError) continue;

        const chatGroupIds = chatGroups.map(cg => cg.chat_group_id);

        if (chatGroupIds.length === 0) {
          // Agent has no chats in this period
          agentRankings.push({
            agentId,
            agentName,
            averageRating: 0,
            totalRatings: 0,
            totalChats: 0,
            satisfactionRate: 0
          });
          continue;
        }

        // Get ratings for this agent's chat groups
        const { data: ratings, error: ratingsError } = await supabase
          .from('chat_feedback')
          .select('rating')
          .in('chat_group_id', chatGroupIds)
          .not('rating', 'is', null)
          .gte('created_at', startDate.toISOString());

        if (ratingsError) continue;

        // Calculate metrics
        const totalRatings = ratings.length;
        const totalScore = ratings.reduce((sum, r) => sum + r.rating, 0);
        const averageRating = totalRatings > 0 ? totalScore / totalRatings : 0;
        
        // Calculate satisfaction rate (4-5 star ratings)
        const satisfiedCount = ratings.filter(r => r.rating >= 4).length;
        const satisfactionRate = totalRatings > 0 ? (satisfiedCount / totalRatings) * 100 : 0;

        agentRankings.push({
          agentId,
          agentName,
          averageRating: Math.round(averageRating * 10) / 10,
          totalRatings,
          totalChats: chatGroupIds.length,
          satisfactionRate: Math.round(satisfactionRate)
        });
      }

      // Sort by average rating (highest first), then by total ratings as tiebreaker
      const sortedRankings = agentRankings
        .sort((a, b) => {
          if (b.averageRating !== a.averageRating) {
            return b.averageRating - a.averageRating;
          }
          return b.totalRatings - a.totalRatings;
        })
        .slice(0, limit)
        .map((agent, index) => ({
          ...agent,
          rank: index + 1
        }));

      return {
        rankings: sortedRankings,
        departmentId,
        period,
        totalAgents: agentRankings.length
      };
    } catch (error) {
      console.error('Error in getDepartmentRankings:', error);
      throw error;
    }
  }

  /**
   * Format time in seconds to human-readable format
   * @param {number} seconds - Time in seconds
   * @returns {string} Formatted time string (e.g., "45s", "2m 30s", "1h 15m")
   */
  formatTime(seconds) {
    if (!seconds || seconds === 0) return '0s';
    
    // If it's already a formatted string, return it
    if (typeof seconds === 'string') return seconds;
    
    // Convert to number if needed
    const time = Number(seconds);
    
    if (time < 60) {
      return `${Math.round(time)}s`;
    } else if (time < 3600) {
      const minutes = Math.floor(time / 60);
      const remainingSeconds = Math.round(time % 60);
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    } else {
      const hours = Math.floor(time / 3600);
      const minutes = Math.floor((time % 3600) / 60);
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
  }

  /**
   * Get performance rating based on average response time
   * @param {number} avgResponseTime - Average response time in seconds
   * @returns {string} Performance rating
   */
  getPerformanceRating(avgResponseTime) {
    if (avgResponseTime < 30) return 'Excellent';
    if (avgResponseTime < 60) return 'Good';
    if (avgResponseTime < 120) return 'Fair';
    return 'Needs Improvement';
  }

  /**
   * Get comprehensive dashboard statistics using chat_group data
   * @param {number} agentId - Optional agent ID for agent-specific stats
   * @param {Object} dateParams - Optional date parameters
   * @returns {Object} Dashboard statistics
   */
  async getComprehensiveDashboardStats(agentId = null, dateParams = {}) {
    try {
      console.log('📊 Getting comprehensive dashboard stats...', { agentId, dateParams });
      
      // Determine date range based on parameters
      let startDate = null;
      let endDate = null;
      
      if (dateParams.date) {
        startDate = new Date(dateParams.date);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(dateParams.date);
        endDate.setHours(23, 59, 59, 999);
      } else if (dateParams.week) {
        const weekStart = new Date(dateParams.week);
        const day = weekStart.getDay();
        const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
        weekStart.setDate(diff);
        weekStart.setHours(0, 0, 0, 0);
        
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        
        startDate = weekStart;
        endDate = weekEnd;
      } else if (dateParams.month) {
        const [year, month] = dateParams.month.split('-');
        startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        startDate.setHours(0, 0, 0, 0);
        
        endDate = new Date(parseInt(year), parseInt(month), 0);
        endDate.setHours(23, 59, 59, 999);
      } else if (dateParams.year) {
        startDate = new Date(parseInt(dateParams.year), 0, 1);
        startDate.setHours(0, 0, 0, 0);
        
        endDate = new Date(parseInt(dateParams.year), 11, 31);
        endDate.setHours(23, 59, 59, 999);
      }
      
      // Build chat groups query
      let chatGroupQuery = supabase
        .from('chat_group')
        .select(`
          chat_group_id,
          created_at,
          status,
          first_response_at,
          resolved_at,
          ended_at,
          response_time_minutes,
          average_response_time_seconds,
          total_response_time_seconds,
          total_agent_responses,
          sys_user_id,
          feedback_id
        `);
      
      // Filter by agent if specified
      if (agentId) {
        chatGroupQuery = chatGroupQuery.eq('sys_user_id', agentId);
      }
      
      // Apply date filtering if specified
      if (startDate && endDate) {
        chatGroupQuery = chatGroupQuery
          .gte('created_at', startDate.toISOString())
          .lte('created_at', endDate.toISOString());
      }
      
      const { data: chatGroups, error: chatGroupError } = await chatGroupQuery;
      
      if (chatGroupError) throw chatGroupError;

      // Get message count for the period
      let messageQuery = supabase
        .from('chat')
        .select('chat_id', { count: 'exact', head: true });
      
      if (agentId) {
        messageQuery = messageQuery.eq('sys_user_id', agentId);
      }
      
      if (startDate && endDate) {
        messageQuery = messageQuery
          .gte('chat_created_at', startDate.toISOString())
          .lte('chat_created_at', endDate.toISOString());
      }
      
      const { count: totalMessages } = await messageQuery;

      // Calculate statistics from chat groups
      const totalChats = chatGroups.length;
      const resolvedChats = chatGroups.filter(cg => cg.status === 'resolved').length;
      const activeChats = chatGroups.filter(cg => cg.status === 'active').length;
      const queuedChats = chatGroups.filter(cg => cg.status === 'queued').length;
      const endedChats = chatGroups.filter(cg => cg.status === 'ended').length;

      // Calculate response time statistics
      const chatGroupsWithResponse = chatGroups.filter(cg => 
        cg.total_response_time_seconds && cg.total_agent_responses
      );
      
      const totalResponseTime = chatGroupsWithResponse.reduce((sum, cg) => 
        sum + (cg.total_response_time_seconds || 0), 0
      );
      const totalResponses = chatGroupsWithResponse.reduce((sum, cg) => 
        sum + (cg.total_agent_responses || 0), 0
      );
      const averageResponseTime = totalResponses > 0 ? totalResponseTime / totalResponses : 0;

      // Calculate first response statistics
      const chatGroupsWithFirstResponse = chatGroups.filter(cg => 
        cg.first_response_at && cg.response_time_minutes
      );
      const totalFirstResponseTime = chatGroupsWithFirstResponse.reduce((sum, cg) => 
        sum + (cg.response_time_minutes || 0), 0
      );
      const firstResponseAverage = chatGroupsWithFirstResponse.length > 0 ? 
        totalFirstResponseTime / chatGroupsWithFirstResponse.length : 0;

      // Calculate rates
      const resolutionRate = totalChats > 0 ? Math.round((resolvedChats / totalChats) * 100) : 0;
      const responseRate = totalChats > 0 ? 
        Math.round((chatGroupsWithFirstResponse.length / totalChats) * 100) : 0;

      // Get feedback statistics if available
      const chatGroupsWithFeedback = chatGroups.filter(cg => cg.feedback_id);
      
      const result = {
        overview: {
          totalChats,
          totalMessages: totalMessages || 0,
          resolvedChats,
          activeChats,
          queuedChats,
          endedChats,
          resolutionRate,
          responseRate
        },
        responseTime: {
          averageResponseTime: Math.round(averageResponseTime),
          firstResponseAverage: Math.round(firstResponseAverage * 60), // Convert to seconds
          totalResponses,
          chatGroupsWithResponse: chatGroupsWithResponse.length,
          chatGroupsWithFirstResponse: chatGroupsWithFirstResponse.length,
          formatted: {
            averageResponseTime: this.formatTime(averageResponseTime),
            firstResponseAverage: this.formatTime(firstResponseAverage * 60)
          }
        },
        satisfaction: {
          totalFeedback: chatGroupsWithFeedback.length,
          feedbackRate: totalChats > 0 ? 
            Math.round((chatGroupsWithFeedback.length / totalChats) * 100) : 0
        },
        period: dateParams,
        agentId
      };

      console.log('📊 Comprehensive dashboard stats result:', result);
      return result;

    } catch (error) {
      console.error('Error in getComprehensiveDashboardStats:', error);
      throw error;
    }
  }

  /**
   * Get dashboard statistics
   * @param {Object} dateParams - Optional date parameters
   * @returns {Object} Dashboard statistics
   */
  async getDashboardStats(dateParams = {}) {
    try {
      console.log('📊 Getting dashboard stats...', dateParams);
      
      // Determine date range based on parameters
      let startDate = null;
      let endDate = null;
      
      if (dateParams.date) {
        // For specific date, get stats for that day
        startDate = new Date(dateParams.date);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(dateParams.date);
        endDate.setHours(23, 59, 59, 999);
      } else if (dateParams.week) {
        // For specific week, get stats for that week
        const weekStart = new Date(dateParams.week);
        const day = weekStart.getDay();
        const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
        weekStart.setDate(diff);
        weekStart.setHours(0, 0, 0, 0);
        
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        
        startDate = weekStart;
        endDate = weekEnd;
      } else if (dateParams.month) {
        // For specific month, get stats for that month
        const [year, month] = dateParams.month.split('-');
        startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        startDate.setHours(0, 0, 0, 0);
        
        endDate = new Date(parseInt(year), parseInt(month), 0); // Last day of month
        endDate.setHours(23, 59, 59, 999);
      } else if (dateParams.year) {
        // For specific year, get stats for that year
        startDate = new Date(parseInt(dateParams.year), 0, 1);
        startDate.setHours(0, 0, 0, 0);
        
        endDate = new Date(parseInt(dateParams.year), 11, 31);
        endDate.setHours(23, 59, 59, 999);
      }
      
      console.log('📊 Date range:', { startDate: startDate?.toISOString(), endDate: endDate?.toISOString() });
      
      // Build queries with date filtering if specified
      let chatGroupQuery = supabase.from('chat_group').select('*', { count: 'exact', head: true });
      let feedbackQuery = supabase.from('chat_feedback').select('rating').not('rating', 'is', null);
      let usersQuery = supabase.from('sys_user').select('*', { count: 'exact', head: true }).eq('sys_user_is_active', true);
      
      if (startDate && endDate) {
        chatGroupQuery = chatGroupQuery.gte('created_at', startDate.toISOString()).lte('created_at', endDate.toISOString());
        feedbackQuery = feedbackQuery.gte('created_at', startDate.toISOString()).lte('created_at', endDate.toISOString());
        // Users query doesn't need date filtering as it's about active status
      }
      
      // Get basic counts with error handling
      const [
        chatGroupsResult,
        feedbackResult,
        usersResult
      ] = await Promise.allSettled([
        chatGroupQuery,
        feedbackQuery,
        usersQuery
      ]);

      const totalChats = chatGroupsResult.status === 'fulfilled' ? (chatGroupsResult.value.count || 0) : 0;
      const feedbackData = feedbackResult.status === 'fulfilled' ? (feedbackResult.value.data || []) : [];
      const activeAgents = usersResult.status === 'fulfilled' ? (usersResult.value.count || 0) : 0;

      console.log('📊 Dashboard stats raw data:', { 
        totalChats, 
        feedbackCount: feedbackData.length, 
        activeAgents,
        feedbackSample: feedbackData.slice(0, 3)
      });

      // Calculate satisfaction metrics
      const totalRatings = feedbackData.length;
      const averageRating = totalRatings > 0 
        ? feedbackData.reduce((sum, f) => sum + (f.rating || 0), 0) / totalRatings 
        : 0;
      
      // Calculate rating distribution
      const ratingDistribution = {
        1: feedbackData.filter(f => f.rating === 1).length,
        2: feedbackData.filter(f => f.rating === 2).length,
        3: feedbackData.filter(f => f.rating === 3).length,
        4: feedbackData.filter(f => f.rating === 4).length,
        5: feedbackData.filter(f => f.rating === 5).length
      };
      
      console.log('📊 Calculated satisfaction:', { 
        averageRating: averageRating.toFixed(1), 
        totalRatings,
        ratingDistribution
      });

      // Get resolved chats count
      let resolvedChats = 0;
      try {
        let resolvedQuery = supabase
          .from('chat_group')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'resolved');
          
        if (startDate && endDate) {
          resolvedQuery = resolvedQuery.gte('created_at', startDate.toISOString()).lte('created_at', endDate.toISOString());
        }
        
        const { count } = await resolvedQuery;
        resolvedChats = count || 0;
      } catch (error) {
        console.warn('Could not get resolved chats count:', error.message);
      }

      const resolutionRate = totalChats > 0 ? Math.round((resolvedChats / totalChats) * 100) : 0;

      const result = {
        overview: {
          activityPercentage: Math.min(Math.round((totalChats / 100) * 67), 100) // Mock calculation
        },
        satisfaction: {
          averageRating: Number(averageRating.toFixed(1)),
          totalRatings,
          ratingDistribution, // Add rating distribution
          growth: 5, // Mock growth
          chartData: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            data: [4.2, 4.5, 4.3, 4.6, 4.4, 4.1, 4.3] // Mock data
          }
        },
        engagement: {
          activeUsers: Math.round((activeAgents / Math.max(activeAgents + 10, 1)) * 100), // Mock calculation
          activeUsersGrowth: 12,
          avgSessionTime: '2.4h',
          sessionTimeGrowth: 8,
          resolutionRate,
          resolutionRateGrowth: 3,
          totalTickets: totalChats,
          totalTicketsGrowth: totalChats > 100 ? 5 : -2
        }
      };

      console.log('📊 Dashboard stats result:', result);
      return result;
    } catch (error) {
      console.error('Error in getDashboardStats:', error);
      // Return default values instead of throwing
      return {
        overview: { activityPercentage: 0 },
        satisfaction: { 
          averageRating: 0, 
          totalRatings: 0,
          ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, // Add rating distribution
          growth: 0,
          chartData: { labels: [], data: [] }
        },
        engagement: {
          activeUsers: 0,
          activeUsersGrowth: 0,
          avgSessionTime: '0h',
          sessionTimeGrowth: 0,
          resolutionRate: 0,
          resolutionRateGrowth: 0,
          totalTickets: 0,
          totalTicketsGrowth: 0
        }
      };
    }
  }

  /**
   * Get period configuration (interval, format, labels)
   * @param {string} period - 'daily', 'weekly', 'monthly', 'yearly'
   * @returns {Object} Period configuration
   */
  getPeriodConfig(period, dateParams = {}) {
    const configs = {
      daily: {
        interval: '1 day',
        labels: Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`)
      },
      weekly: {
        interval: '7 days',
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      },
      monthly: {
        interval: '30 days',
        labels: Array.from({ length: 30 }, (_, i) => (i + 1).toString().padStart(2, '0'))
      },
      yearly: {
        interval: '1 year',
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      }
    };

    return configs[period] || configs.weekly;
  }

  /**
   * Get start date for a specific period with date/week/month/year parameters
   */
  getStartDateForPeriod(period, dateParams = {}) {
    if (period === 'daily' && dateParams.date) {
      // For daily view with specific date, start from beginning of that day
      const date = new Date(dateParams.date);
      date.setHours(0, 0, 0, 0);
      return date;
    } else if (period === 'weekly' && dateParams.week) {
      // For weekly view with specific week, start from the Monday of that week
      const weekStart = new Date(dateParams.week);
      const day = weekStart.getDay();
      const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
      weekStart.setDate(diff);
      weekStart.setHours(0, 0, 0, 0);
      return weekStart;
    } else if (period === 'monthly' && dateParams.month) {
      // For monthly view with specific month, start from the first day of that month
      const [year, month] = dateParams.month.split('-');
      const monthStart = new Date(parseInt(year), parseInt(month) - 1, 1);
      monthStart.setHours(0, 0, 0, 0);
      return monthStart;
    } else if (period === 'yearly' && dateParams.year) {
      // For yearly view with specific year, start from January 1st of that year
      const yearStart = new Date(parseInt(dateParams.year), 0, 1);
      yearStart.setHours(0, 0, 0, 0);
      return yearStart;
    } else {
      // Default behavior - use interval from current time
      const { interval } = this.getPeriodConfig(period);
      return new Date(Date.now() - this.intervalToMs(interval));
    }
  }

  /**
   * Get end date for a specific period with date/week/month/year parameters
   */
  getEndDateForPeriod(period, dateParams = {}) {
    if (period === 'daily' && dateParams.date) {
      // For daily view with specific date, end at end of that day
      const date = new Date(dateParams.date);
      date.setHours(23, 59, 59, 999);
      return date;
    } else if (period === 'weekly' && dateParams.week) {
      // For weekly view with specific week, end at Sunday of that week
      const weekStart = new Date(dateParams.week);
      const day = weekStart.getDay();
      const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
      weekStart.setDate(diff);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      return weekEnd;
    } else if (period === 'monthly' && dateParams.month) {
      // For monthly view with specific month, end at last day of that month
      const [year, month] = dateParams.month.split('-');
      const monthEnd = new Date(parseInt(year), parseInt(month), 0); // Last day of month
      monthEnd.setHours(23, 59, 59, 999);
      return monthEnd;
    } else if (period === 'yearly' && dateParams.year) {
      // For yearly view with specific year, end at December 31st of that year
      const yearEnd = new Date(parseInt(dateParams.year), 11, 31);
      yearEnd.setHours(23, 59, 59, 999);
      return yearEnd;
    } else {
      // Default behavior - current time
      return new Date();
    }
  }

  /**
   * Calculate trend percentage compared to previous period
   * @param {string} metric - 'messages' or 'response_time'
   * @param {string} period - Time period
   * @param {number} currentValue - Current period value
   * @returns {string} Trend percentage (e.g., '+12%' or '-5%')
   */
  async calculateTrend(metric, period, currentValue, agentId = null) {
    try {
      // Add timeout protection for trend calculation
      const trendPromise = this.calculateTrendInternal(metric, period, currentValue, agentId);
      const timeoutPromise = new Promise((resolve) => 
        setTimeout(() => resolve('+0%'), 5000) // 5 second timeout
      );
      
      return await Promise.race([trendPromise, timeoutPromise]);
    } catch (error) {
      console.error('Error calculating trend:', error);
      return '+0%';
    }
  }

  /**
   * Internal trend calculation with simplified logic
   */
  async calculateTrendInternal(metric, period, currentValue, agentId = null) {
    const { interval } = this.getPeriodConfig(period);
    
    let previousValue = 0;
    
    if (metric === 'satisfaction') {
      // Simplified satisfaction trend calculation
      const previousStartDate = new Date(Date.now() - 2 * this.intervalToMs(interval));
      const previousEndDate = new Date(Date.now() - this.intervalToMs(interval));
      
      let prevFeedbackQuery = supabase
        .from('chat_feedback')
        .select('rating')
        .not('rating', 'is', null)
        .gte('created_at', previousStartDate.toISOString())
        .lt('created_at', previousEndDate.toISOString())
        .limit(1000); // Add limit for performance

      // If agentId is provided, use a simpler approach
      if (agentId) {
        // Get a limited set of chat groups for this agent
        const { data: agentChatGroups, error: agentError } = await supabase
          .from('chat_group')
          .select('chat_group_id')
          .eq('sys_user_id', agentId)
          .limit(500); // Limit to prevent huge queries

        if (agentError || !agentChatGroups || agentChatGroups.length === 0) {
          return '+0%';
        }
        
        const agentChatGroupIds = agentChatGroups.map(cg => cg.chat_group_id);
        prevFeedbackQuery = prevFeedbackQuery.in('chat_group_id', agentChatGroupIds);
      }

      const { data: prevFeedbacks, error: prevError } = await prevFeedbackQuery;
      
      if (prevError || !prevFeedbacks || prevFeedbacks.length === 0) {
        return '+0%';
      }
      
      previousValue = prevFeedbacks.reduce((sum, f) => sum + f.rating, 0) / prevFeedbacks.length;
    } else {
      // For other metrics, return a simple fallback to avoid complex queries
      return '+0%';
    }

    if (previousValue === 0 || currentValue === 0) return '+0%';
    
    const change = ((currentValue - previousValue) / previousValue) * 100;
    const sign = change >= 0 ? '+' : '';
    
    return `${sign}${Math.round(change)}%`;
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

  /**
   * Format date for period grouping
   */
  formatDateForPeriod(date, period, dateParams = {}) {
    switch (period) {
      case 'daily':
        return `${date.getHours().toString().padStart(2, '0')}:00`;
      case 'weekly':
        // Match the order from getPeriodConfig: Mon, Tue, Wed, Thu, Fri, Sat, Sun
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayIndex = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
        // Convert to Monday-first order: Mon=0, Tue=1, ..., Sun=6
        const mondayFirstIndex = dayIndex === 0 ? 6 : dayIndex - 1;
        const mondayFirstDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        return mondayFirstDays[mondayFirstIndex];
      case 'monthly':
        // For monthly view, return the day of the month (01, 02, 03, etc.)
        // This ensures each day is treated separately within the selected month
        return date.getDate().toString().padStart(2, '0');
      case 'yearly':
        // For yearly view, return the month abbreviation (Jan, Feb, Mar, etc.)
        // This ensures each month is treated separately within the selected year
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[date.getMonth()];
      default:
        // Default to weekly format with Monday-first order
        const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const defaultDayIndex = date.getDay();
        const defaultMondayFirstIndex = defaultDayIndex === 0 ? 6 : defaultDayIndex - 1;
        const defaultMondayFirstDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        return defaultMondayFirstDays[defaultMondayFirstIndex];
    }
  }
}

module.exports = new AnalyticsService();