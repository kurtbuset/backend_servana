const supabase = require('../helpers/supabaseClient');
const cacheService = require('./cache.service');

/**
 * Response Time Calculation Service
 * Handles all response time calculations that were previously done by database triggers
 */
class ResponseTimeService {
  
  /**
   * Calculate response time for a new agent message
   * @param {Object} messageData - The message data being inserted
   * @returns {Object} Updated message data with response_time_seconds
   */
  async calculateResponseTime(messageData) {
    try {
      // Only calculate for agent messages (sys_user_id is not null)
      if (!messageData.sys_user_id || !messageData.chat_group_id) {
        return messageData;
      }

      // Find the previous customer message to calculate response time
      const { data: previousMessage, error } = await supabase
        .from('chat')
        .select('chat_created_at')
        .eq('chat_group_id', messageData.chat_group_id)
        .is('sys_user_id', null) // Customer message
        .order('chat_created_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !previousMessage) {
        // No previous customer message found, set response time to null
        return { ...messageData, response_time_seconds: null };
      }

      // Calculate response time in seconds
      const messageTime = new Date(messageData.chat_created_at || new Date());
      const previousTime = new Date(previousMessage.chat_created_at);
      const responseTimeSeconds = Math.round((messageTime - previousTime) / 1000);

      return {
        ...messageData,
        response_time_seconds: responseTimeSeconds,
        previous_customer_message_id: previousMessage.chat_id
      };

    } catch (error) {
      console.error('❌ Error calculating response time:', error.message);
      // Return original data if calculation fails
      return messageData;
    }
  }

  /**
   * Update chat group analytics after inserting an agent message
   * @param {number} chatGroupId - The chat group ID
   * @param {number} responseTimeSeconds - Response time for this message
   */
  async updateChatGroupAnalytics(chatGroupId, responseTimeSeconds) {
    try {
      // Get current chat group analytics
      const { data: chatGroup, error: fetchError } = await supabase
        .from('chat_group')
        .select('total_response_time_seconds, total_agent_responses, average_response_time_seconds')
        .eq('chat_group_id', chatGroupId)
        .single();

      if (fetchError) {
        console.error('❌ Error fetching chat group for analytics update:', fetchError.message);
        return;
      }

      // Calculate new totals
      const currentTotalTime = chatGroup.total_response_time_seconds || 0;
      const currentTotalResponses = chatGroup.total_agent_responses || 0;
      
      const newTotalResponses = currentTotalResponses + 1;
      const newTotalTime = responseTimeSeconds ? currentTotalTime + responseTimeSeconds : currentTotalTime;
      const newAverageTime = newTotalResponses > 0 ? newTotalTime / newTotalResponses : 0;

      // Update chat group with new analytics
      const { error: updateError } = await supabase
        .from('chat_group')
        .update({
          total_response_time_seconds: newTotalTime,
          total_agent_responses: newTotalResponses,
          average_response_time_seconds: newAverageTime
        })
        .eq('chat_group_id', chatGroupId);

      if (updateError) {
        console.error('❌ Error updating chat group analytics:', updateError.message);
        return;
      }

      // Invalidate related caches
      await cacheService.invalidateChatGroup(chatGroupId);
      
      console.log(`✅ Updated analytics for chat group ${chatGroupId}: ${newTotalResponses} responses, ${Math.round(newAverageTime)}s avg`);

    } catch (error) {
      console.error('❌ Error updating chat group analytics:', error.message);
    }
  }

  /**
   * Set first response timestamp for a chat group
   * @param {number} chatGroupId - The chat group ID
   * @param {Date} responseTime - The timestamp of the first response
   */
  async setFirstResponse(chatGroupId, responseTime) {
    try {
      // Check if first_response_at is already set
      const { data: chatGroup, error: fetchError } = await supabase
        .from('chat_group')
        .select('first_response_at, created_at')
        .eq('chat_group_id', chatGroupId)
        .single();

      if (fetchError || !chatGroup) {
        console.error('❌ Error fetching chat group for first response:', fetchError?.message);
        return;
      }

      // Only set if not already set
      if (!chatGroup.first_response_at) {
        const createdAt = new Date(chatGroup.created_at);
        const firstResponseAt = new Date(responseTime);
        const responseTimeMinutes = (firstResponseAt - createdAt) / (1000 * 60);

        const { error: updateError } = await supabase
          .from('chat_group')
          .update({
            first_response_at: firstResponseAt.toISOString(),
            response_time_minutes: responseTimeMinutes
          })
          .eq('chat_group_id', chatGroupId);

        if (updateError) {
          console.error('❌ Error setting first response time:', updateError.message);
          return;
        }

        console.log(`✅ Set first response for chat group ${chatGroupId}: ${Math.round(responseTimeMinutes)}min`);
      }

    } catch (error) {
      console.error('❌ Error setting first response:', error.message);
    }
  }

  /**
   * Recalculate response times for all existing data
   * This is useful for migrating from trigger-based to application-based calculations
   */
  async recalculateAllResponseTimes() {
    try {
      console.log('🔄 Starting response time recalculation...');

      // Get all chat groups that need recalculation
      const { data: chatGroups, error: groupsError } = await supabase
        .from('chat_group')
        .select('chat_group_id')
        .order('chat_group_id');

      if (groupsError) {
        throw groupsError;
      }

      let processed = 0;
      let updated = 0;

      for (const group of chatGroups) {
        try {
          const result = await this.recalculateChatGroupResponseTimes(group.chat_group_id);
          if (result.updated) updated++;
          processed++;

          if (processed % 100 === 0) {
            console.log(`📊 Processed ${processed}/${chatGroups.length} chat groups...`);
          }
        } catch (error) {
          console.error(`❌ Error recalculating chat group ${group.chat_group_id}:`, error.message);
        }
      }

      console.log(`✅ Recalculation complete: ${updated}/${processed} chat groups updated`);
      return { processed, updated };

    } catch (error) {
      console.error('❌ Error in recalculateAllResponseTimes:', error.message);
      throw error;
    }
  }

  /**
   * Recalculate response times for a specific chat group
   * @param {number} chatGroupId - The chat group ID
   */
  async recalculateChatGroupResponseTimes(chatGroupId) {
    try {
      // Get all messages for this chat group
      const { data: messages, error: messagesError } = await supabase
        .from('chat')
        .select('chat_id, sys_user_id, chat_created_at')
        .eq('chat_group_id', chatGroupId)
        .order('chat_created_at');

      if (messagesError) {
        throw messagesError;
      }

      let totalResponseTime = 0;
      let totalAgentResponses = 0;
      let firstResponseAt = null;
      let responseTimeMinutes = null;

      // Process messages to calculate response times
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        
        // If this is an agent message
        if (message.sys_user_id) {
          totalAgentResponses++;
          
          // Set first response if this is the first agent message
          if (!firstResponseAt) {
            firstResponseAt = message.chat_created_at;
            // Calculate first response time from chat group creation
            const { data: chatGroup } = await supabase
              .from('chat_group')
              .select('created_at')
              .eq('chat_group_id', chatGroupId)
              .single();
            
            if (chatGroup) {
              const createdAt = new Date(chatGroup.created_at);
              const responseAt = new Date(firstResponseAt);
              responseTimeMinutes = (responseAt - createdAt) / (1000 * 60);
            }
          }

          // Find the previous customer message to calculate individual response time
          for (let j = i - 1; j >= 0; j--) {
            if (!messages[j].sys_user_id) { // Customer message
              const responseTime = new Date(message.chat_created_at);
              const customerTime = new Date(messages[j].chat_created_at);
              const responseSeconds = Math.round((responseTime - customerTime) / 1000);
              
              totalResponseTime += responseSeconds;
              
              // Update individual message response time
              await supabase
                .from('chat')
                .update({ 
                  response_time_seconds: responseSeconds,
                  previous_customer_message_id: messages[j].chat_id
                })
                .eq('chat_id', message.chat_id);
              
              break;
            }
          }
        }
      }

      // Calculate average response time
      const averageResponseTime = totalAgentResponses > 0 ? totalResponseTime / totalAgentResponses : 0;

      // Update chat group analytics
      const updateData = {
        total_response_time_seconds: totalResponseTime,
        total_agent_responses: totalAgentResponses,
        average_response_time_seconds: averageResponseTime
      };

      if (firstResponseAt) {
        updateData.first_response_at = firstResponseAt;
        updateData.response_time_minutes = responseTimeMinutes;
      }

      const { error: updateError } = await supabase
        .from('chat_group')
        .update(updateData)
        .eq('chat_group_id', chatGroupId);

      if (updateError) {
        throw updateError;
      }

      return { 
        updated: totalAgentResponses > 0,
        totalResponses: totalAgentResponses,
        averageTime: averageResponseTime
      };

    } catch (error) {
      console.error(`❌ Error recalculating chat group ${chatGroupId}:`, error.message);
      throw error;
    }
  }
}

module.exports = new ResponseTimeService();