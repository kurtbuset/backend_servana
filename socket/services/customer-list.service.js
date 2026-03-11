const chatGroupHelper = require('../helpers/chat-group.helper');
const clientHelper = require('../helpers/client.helper');
const AgentNotifier = require('../notifications/agent.notifier');

/**
 * Customer List Service
 * Handles business logic for customer list updates
 */
class CustomerListService {
  constructor(io) {
    this.io = io;
    this.agentNotifier = new AgentNotifier(io);
  }

  /**
   * Handle real-time customer list updates when messages are sent
   */
  async handleCustomerListUpdate(savedMessage, senderType) {
    try {
      // Only update customer lists when clients send messages
      // (agents sending messages don't change the customer order priority)
      if (senderType !== 'client') {
        return;
      }

      // Get chat group and department information
      const chatGroupInfo = await chatGroupHelper.getChatGroupInfo(savedMessage.chat_group_id);
      if (!chatGroupInfo) {
        console.error('❌ Could not find chat group info for customer list update');
        return;
      }

      // Get client information for the update
      const clientInfo = await clientHelper.getClientInfo(chatGroupInfo.client_id);
      if (!clientInfo) {
        console.error('❌ Could not find client info for customer list update');
        return;
      }

      // Prepare customer update data
      const customerUpdate = {
        chat_group_id: savedMessage.chat_group_id,
        client_id: chatGroupInfo.client_id,
        timestamp: savedMessage.chat_created_at,
        department_id: chatGroupInfo.dept_id,
        customer: {
          id: clientInfo.client_id,
          chat_group_id: savedMessage.chat_group_id,
          name: clientInfo.name,
          number: clientInfo.client_number,
          profile: clientInfo.profile_image,
          time: new Date(savedMessage.chat_created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          status: chatGroupInfo.status,
          department: chatGroupInfo.department?.dept_name || 'Unknown',
        }
      };

      // Emit to agents in the same department
      await this.agentNotifier.notifyDepartmentAgents(chatGroupInfo.dept_id, customerUpdate);

    } catch (error) {
      console.error('❌ Error handling customer list update:', error);
    }
  }
}

module.exports = CustomerListService;
