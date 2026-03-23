const supabase = require('../helpers/supabaseClient');

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
  async getMessageAnalytics(period = 'weekly', agentId = null, dateParams = {}) {
    try {
      const { interval, labels } = this.getPeriodConfig(period, dateParams);
      const startDate = this.getStartDateForPeriod(period, dateParams);
      
      // First, get all chat group IDs that have client inquiries (messages from clients)
      let chatGroupQuery = supabase
        .from('chat')
        .select('chat_group_id')
        .not('client_id', 'is', null)
        .gte('chat_created_at', startDate.toISOString());

      // If agentId is provided, filter by chat groups assigned to this agent
      if (agentId) {
        // Get chat groups assigned to this specific agent
        const { data: agentChatGroups, error: agentError } = await supabase
          .from('chat_group')
          .select('chat_group_id')
          .eq('sys_user_id', agentId);

        if (agentError) throw agentError;

        const agentChatGroupIds = agentChatGroups.map(cg => cg.chat_group_id);
        
        if (agentChatGroupIds.length === 0) {
          // Agent has no chat groups, return empty data
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

        // Filter by agent's chat groups
        chatGroupQuery = chatGroupQuery.in('chat_group_id', agentChatGroupIds);
      }

      const { data: chatGroupsWithInquiries, error: inquiryError } = await chatGroupQuery;

      if (inquiryError) throw inquiryError;

      // Extract unique chat group IDs
      const validChatGroupIds = [...new Set(chatGroupsWithInquiries.map(item => item.chat_group_id))];

      if (validChatGroupIds.length === 0) {
        // No inquiries found, return empty data
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

      // Now get all messages from chat groups that have client inquiries
      let messagesQuery = supabase
        .from('chat')
        .select('chat_created_at, chat_group_id, client_id, sys_user_id')
        .in('chat_group_id', validChatGroupIds)
        .gte('chat_created_at', startDate.toISOString());

      // For specific date/week/month/year filtering, add end date constraint
      if (dateParams.date || dateParams.week || dateParams.month || dateParams.year) {
        const endDate = this.getEndDateForPeriod(period, dateParams);
        messagesQuery = messagesQuery.lte('chat_created_at', endDate.toISOString());
      }

      // If agentId is provided, only count messages from this agent (not client messages)
      if (agentId) {
        messagesQuery = messagesQuery.eq('sys_user_id', agentId);
      }

      const { data: messages, error } = await messagesQuery;

      if (error) throw error;

      // Process data by time periods
      const periodData = {};
      labels.forEach(label => {
        periodData[label] = 0;
      });

      messages.forEach(message => {
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

      const totalMessages = messages.length;
      const trend = await this.calculateTrend('messages', period, totalMessages, agentId);

      return {
        total: totalMessages,
        totalMessages, // Keep for backward compatibility
        values: chartData.data,
        labels: chartData.labels,
        chartData, // Keep for backward compatibility
        trend,
        growth: parseInt(trend.replace(/[+%]/g, '')) || 0,
        period,
        chatGroupsWithInquiries: validChatGroupIds.length,
        agentId
      };
    } catch (error) {
      console.error('Error in getMessageAnalytics:', error);
      throw error;
    }
  }

  /**
   * Get enhanced response time analytics using comprehensive ART calculation
   * @param {string} period - 'daily', 'weekly', 'monthly', 'yearly'
   * @returns {Object} Enhanced response time analytics data
   */
  async getEnhancedResponseTimeAnalytics(period = 'weekly', dateParams = {}) {
    try {
      const { interval, labels } = this.getPeriodConfig(period, dateParams);
      const startDate = this.getStartDateForPeriod(period, dateParams);
      
      // Get chat groups with response time data
      let chatGroupQuery = supabase
        .from('chat_group')
        .select('created_at, average_response_time_seconds, total_response_time_seconds, total_agent_responses')
        .not('average_response_time_seconds', 'is', null)
        .gte('created_at', startDate.toISOString());

      // For specific date/week/month/year filtering, add end date constraint
      if (dateParams.date || dateParams.week || dateParams.month || dateParams.year) {
        const endDate = this.getEndDateForPeriod(period, dateParams);
        chatGroupQuery = chatGroupQuery.lte('created_at', endDate.toISOString());
      }

      const { data: chatGroups, error } = await chatGroupQuery;

      if (error) throw error;

      // Process data by time periods
      const periodData = {};
      labels.forEach(label => {
        periodData[label] = {
          totalResponseTime: 0,
          totalResponses: 0,
          chats: []
        };
      });

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

  /**
   * Get legacy response time analytics (first response only)
   * @param {string} period - 'daily', 'weekly', 'monthly', 'yearly'
   * @returns {Object} Legacy response time analytics data
   */
  async getResponseTimeAnalytics(period = 'weekly', dateParams = {}) {
    try {
      const { interval, labels } = this.getPeriodConfig(period, dateParams);
      const startDate = this.getStartDateForPeriod(period, dateParams);
      
      // Use first_response_at for legacy compatibility
      let chatGroupQuery = supabase
        .from('chat_group')
        .select('first_response_at, created_at, response_time_minutes')
        .not('first_response_at', 'is', null)
        .gte('created_at', startDate.toISOString());

      // For specific date/week/month/year filtering, add end date constraint
      if (dateParams.date || dateParams.week || dateParams.month || dateParams.year) {
        const endDate = this.getEndDateForPeriod(period, dateParams);
        chatGroupQuery = chatGroupQuery.lte('created_at', endDate.toISOString());
      }

      const { data, error } = await chatGroupQuery;

      if (error) throw error;

      // Process data by time periods
      const periodData = {};
      labels.forEach(label => {
        periodData[label] = {
          totalResponseTime: 0,
          count: 0,
          responses: []
        };
      });

      data.forEach(chat => {
        const createdDate = new Date(chat.created_at);
        const periodKey = this.formatDateForPeriod(createdDate, period, dateParams);
        
        if (periodData[periodKey] && chat.response_time_minutes) {
          periodData[periodKey].totalResponseTime += chat.response_time_minutes;
          periodData[periodKey].count += 1;
          periodData[periodKey].responses.push(chat.response_time_minutes);
        }
      });

      // Calculate averages and format data
      const chartData = {
        labels: labels,
        data: labels.map(label => {
          const period = periodData[label];
          return period.count > 0 ? (period.totalResponseTime / period.count) : 0;
        })
      };

      const totalResponses = Object.values(periodData).reduce((sum, p) => sum + p.count, 0);
      const totalTime = Object.values(periodData).reduce((sum, p) => sum + p.totalResponseTime, 0);
      const averageResponseTime = totalResponses > 0 ? totalTime / totalResponses : 0;

      // Calculate trend
      const trend = await this.calculateTrend('response_time', period, averageResponseTime);

      return {
        average: Math.round(averageResponseTime * 100) / 100, // Round to 2 decimal places
        averageResponseTime: averageResponseTime * 60, // Convert to seconds for consistency
        totalResponses,
        values: chartData.data,
        labels: chartData.labels,
        chartData, // Keep for backward compatibility
        trend,
        growth: parseInt(trend.replace(/[+%-]/g, '')) || 0,
        period,
        type: 'legacy',
        formatted: {
          averageResponseTime: this.formatTime(averageResponseTime * 60)
        }
      };
    } catch (error) {
      console.error('Error in getResponseTimeAnalytics:', error);
      throw error;
    }
  }

  /**
   * Get agent performance analytics based on response times
   * @param {number} sysUserId - Optional specific sys_user_id
   * @param {string} period - Time period for analysis
   * @returns {Array} Agent performance data
   */
  async getAgentPerformanceAnalytics(sysUserId = null, period = 'weekly', dateParams = {}) {
    try {
      const { interval } = this.getPeriodConfig(period, dateParams);
      const startDate = this.getStartDateForPeriod(period, dateParams);
      
      let query = supabase
        .from('chat_group')
        .select(`
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
        `)
        .not('sys_user_id', 'is', null)
        .not('average_response_time_seconds', 'is', null)
        .gte('created_at', startDate.toISOString());

      // For specific date/week/month/year filtering, add end date constraint
      if (dateParams.date || dateParams.week || dateParams.month || dateParams.year) {
        const endDate = this.getEndDateForPeriod(period, dateParams);
        query = query.lte('created_at', endDate.toISOString());
      }

      if (sysUserId) {
        query = query.eq('sys_user_id', sysUserId);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Group by agent
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
   * Format time in seconds to human readable format
   * @param {number} seconds - Time in seconds
   * @returns {string} Formatted time string
   */
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
      
      // Get all feedback ratings within the period
      let feedbackQuery = supabase
        .from('chat_feedback')
        .select('rating, created_at, chat_group_id')
        .not('rating', 'is', null)
        .gte('created_at', startDate.toISOString());

      // For specific date/week/month/year filtering, add end date constraint
      if (dateParams.date || dateParams.week || dateParams.month || dateParams.year) {
        const endDate = this.getEndDateForPeriod(period, dateParams);
        feedbackQuery = feedbackQuery.lte('created_at', endDate.toISOString());
      }

      // If agentId is provided, filter by agent's chat groups
      if (agentId) {
        const { data: agentChatGroups, error: agentError } = await supabase
          .from('chat_group')
          .select('chat_group_id')
          .eq('sys_user_id', agentId);

        if (agentError) throw agentError;

        const agentChatGroupIds = agentChatGroups.map(cg => cg.chat_group_id);
        
        if (agentChatGroupIds.length === 0) {
          // Agent has no chat groups, return empty data
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

        feedbackQuery = feedbackQuery.in('chat_group_id', agentChatGroupIds);
      }

      const { data: feedbacks, error } = await feedbackQuery;

      if (error) throw error;

      // Process data by time periods
      const periodData = {};
      labels.forEach(label => {
        periodData[label] = {
          totalRating: 0,
          count: 0,
          ratings: []
        };
      });

      feedbacks.forEach(feedback => {
        const feedbackDate = new Date(feedback.created_at);
        const periodKey = this.formatDateForPeriod(feedbackDate, period, dateParams);
        
        if (periodData[periodKey]) {
          periodData[periodKey].totalRating += feedback.rating;
          periodData[periodKey].count += 1;
          periodData[periodKey].ratings.push(feedback.rating);
        }
      });

      // Calculate averages for chart
      const chartData = {
        labels: labels,
        data: labels.map(label => {
          const period = periodData[label];
          return period.count > 0 ? (period.totalRating / period.count) : 0;
        })
      };

      // Calculate overall metrics
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

      const trend = await this.calculateTrend('satisfaction', period, averageRating, agentId);

      return {
        averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
        totalRatings,
        satisfactionRate: Math.round(satisfactionRate),
        ratingDistribution,
        values: chartData.data,
        labels: chartData.labels,
        chartData, // Keep for backward compatibility
        trend,
        growth: parseInt(trend.replace(/[+%-]/g, '')) || 0,
        period,
        agentId,
        formatted: {
          averageRating: `${Math.round(averageRating * 10) / 10}/5.0`,
          satisfactionRate: `${Math.round(satisfactionRate)}%`
        }
      };
    } catch (error) {
      console.error('Error in getCustomerSatisfactionAnalytics:', error);
      throw error;
    }
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

  formatTime(seconds) {
    if (!seconds || seconds === 0) return '0s';
    
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = Math.round(seconds % 60);
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
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
   * Get dashboard statistics
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

      console.log('📊 Dashboard stats:', { totalChats, feedbackCount: feedbackData.length, activeAgents });

      // Calculate satisfaction metrics
      const totalRatings = feedbackData.length;
      const averageRating = totalRatings > 0 
        ? feedbackData.reduce((sum, f) => sum + (f.rating || 0), 0) / totalRatings 
        : 0;

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
      const { interval } = this.getPeriodConfig(period);
      
      let previousValue;
      if (metric === 'messages') {
        // Use the same logic as getMessageAnalytics for consistency
        const previousStartDate = new Date(Date.now() - 2 * this.intervalToMs(interval));
        const previousEndDate = new Date(Date.now() - this.intervalToMs(interval));
        
        // Get chat groups with client inquiries in the previous period
        let prevChatGroupQuery = supabase
          .from('chat')
          .select('chat_group_id')
          .not('client_id', 'is', null)
          .gte('chat_created_at', previousStartDate.toISOString())
          .lt('chat_created_at', previousEndDate.toISOString());

        // If agentId is provided, filter by agent's chat groups
        if (agentId) {
          const { data: agentChatGroups, error: agentError } = await supabase
            .from('chat_group')
            .select('chat_group_id')
            .eq('sys_user_id', agentId);

          if (agentError) throw agentError;

          const agentChatGroupIds = agentChatGroups.map(cg => cg.chat_group_id);
          
          if (agentChatGroupIds.length === 0) {
            previousValue = 0;
          } else {
            prevChatGroupQuery = prevChatGroupQuery.in('chat_group_id', agentChatGroupIds);
          }
        }

        if (agentId && previousValue === 0) {
          // Agent has no chat groups, skip query
        } else {
          const { data: prevChatGroupsWithInquiries, error: prevInquiryError } = await prevChatGroupQuery;

          if (prevInquiryError) throw prevInquiryError;

          const prevValidChatGroupIds = [...new Set(prevChatGroupsWithInquiries.map(item => item.chat_group_id))];

          if (prevValidChatGroupIds.length === 0) {
            previousValue = 0;
          } else {
            // Count messages from those chat groups
            let prevMessagesQuery = supabase
              .from('chat')
              .select('*', { count: 'exact', head: true })
              .in('chat_group_id', prevValidChatGroupIds)
              .gte('chat_created_at', previousStartDate.toISOString())
              .lt('chat_created_at', previousEndDate.toISOString());

            // If agentId is provided, only count agent messages
            if (agentId) {
              prevMessagesQuery = prevMessagesQuery.eq('sys_user_id', agentId);
            }

            const { data: prevMessages, error: prevError } = await prevMessagesQuery;

            if (prevError) throw prevError;
            previousValue = prevMessages?.length || 0;
          }
        }
      } else if (metric === 'satisfaction') {
        // For satisfaction ratings
        const previousStartDate = new Date(Date.now() - 2 * this.intervalToMs(interval));
        const previousEndDate = new Date(Date.now() - this.intervalToMs(interval));
        
        let prevFeedbackQuery = supabase
          .from('chat_feedback')
          .select('rating, chat_group_id')
          .not('rating', 'is', null)
          .gte('created_at', previousStartDate.toISOString())
          .lt('created_at', previousEndDate.toISOString());

        // If agentId is provided, filter by agent's chat groups
        if (agentId) {
          const { data: agentChatGroups, error: agentError } = await supabase
            .from('chat_group')
            .select('chat_group_id')
            .eq('sys_user_id', agentId);

          if (agentError) throw agentError;

          const agentChatGroupIds = agentChatGroups.map(cg => cg.chat_group_id);
          
          if (agentChatGroupIds.length === 0) {
            previousValue = 0;
          } else {
            prevFeedbackQuery = prevFeedbackQuery.in('chat_group_id', agentChatGroupIds);
          }
        }

        if (agentId && previousValue === 0) {
          // Agent has no chat groups, skip query
        } else {
          const { data: prevFeedbacks, error: prevError } = await prevFeedbackQuery;

          if (prevError) throw prevError;
          
          previousValue = prevFeedbacks && prevFeedbacks.length > 0
            ? prevFeedbacks.reduce((sum, f) => sum + f.rating, 0) / prevFeedbacks.length
            : 0;
        }
      } else {
        // For response time metrics, use the existing logic
        let query = supabase
          .from('chat_group')
          .select('response_time_minutes')
          .not('response_time_minutes', 'is', null)
          .gte('created_at', new Date(Date.now() - 2 * this.intervalToMs(interval)).toISOString())
          .lt('created_at', new Date(Date.now() - this.intervalToMs(interval)).toISOString());

        // If agentId is provided, filter by agent
        if (agentId) {
          query = query.eq('sys_user_id', agentId);
        }

        const { data } = await query;
        
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