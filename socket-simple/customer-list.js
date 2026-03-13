/**
 * Customer List Management
 * Handles real-time customer list updates for agents
 */

const supabase = require('../helpers/supabaseClient');

/**
 * Get chat group information
 */
async function getChatGroupInfo(chatGroupId) {
  try {
    const { data, error } = await supabase
      .from('chat_group')
      .select(`
        chat_group_id,
        client_id,
        dept_id,
        sys_user_id,
        status,
        department:dept_id (
          dept_name
        )
      `)
      .eq('chat_group_id', chatGroupId)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('❌ Error fetching chat group info:', error);
    return null;
  }
}

/**
 * Get client information
 */
async function getClientInfo(clientId) {
  try {
    const { data, error } = await supabase
      .from('client')
      .select(`
        client_id,
        client_number,
        prof_id,
        profile:prof_id (
          prof_firstname,
          prof_lastname,
          prof_image
        )
      `)
      .eq('client_id', clientId)
      .single();

    if (error) throw error;

    return {
      client_id: data.client_id,
      client_number: data.client_number,
      name: data.profile ? `${data.profile.prof_firstname} ${data.profile.prof_lastname}`.trim() : 'Unknown',
      profile_image: data.profile?.prof_image || null
    };
  } catch (error) {
    console.error('❌ Error fetching client info:', error);
    return null;
  }
}

/**
 * Handle customer list update when a message is sent
 */
async function handleCustomerListUpdate(io, savedMessage, senderType) {
  try {
    // Only update customer lists when clients send messages
    // (agents sending messages don't change the customer order priority)
    if (senderType !== 'client') {
      return;
    }

    // Get chat group and department information
    const chatGroupInfo = await getChatGroupInfo(savedMessage.chat_group_id);
    if (!chatGroupInfo) {
      console.error('❌ Could not find chat group info for customer list update');
      return;
    }

    // Get client information for the update
    const clientInfo = await getClientInfo(chatGroupInfo.client_id);
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

    // Broadcast to agents in the department
    broadcastCustomerListUpdate(io, chatGroupInfo.dept_id, {
      type: 'move_to_top',
      data: customerUpdate
    });

  } catch (error) {
    console.error('❌ Error handling customer list update:', error);
  }
}

/**
 * Broadcast customer list update to department agents
 */
function broadcastCustomerListUpdate(io, departmentId, updateData) {
  const roomName = `department_${departmentId}`;
  io.to(roomName).emit('customerListUpdate', updateData);
  console.log(`📋 Broadcast customer list update to department ${departmentId}:`, updateData.type);
}

/**
 * Handle chat resolution customer list update
 */
function handleChatResolved(io, chatGroupId, departmentId) {
  broadcastCustomerListUpdate(io, departmentId, {
    type: 'chat_resolved',
    data: {
      chat_group_id: chatGroupId,
      department_id: departmentId
    }
  });
}


/**
 * Handle chat reactivation customer list update
 */
function handleChatReactivated(io, chatGroupId, departmentId, agentId) {
  broadcastCustomerListUpdate(io, departmentId, {
    type: 'chat_reactivated',
    data: {
      chat_group_id: chatGroupId,
      department_id: departmentId,
      agent_id: agentId
    }
  });
}

/**
 * Handle new chat assignment
 */
async function handleChatAssignment(io, chatGroupId, agentId) {
  try {
    const chatGroupInfo = await getChatGroupInfo(chatGroupId);
    if (!chatGroupInfo) return;

    const clientInfo = await getClientInfo(chatGroupInfo.client_id);
    if (!clientInfo) return;

    const customerUpdate = {
      chat_group_id: chatGroupId,
      client_id: chatGroupInfo.client_id,
      department_id: chatGroupInfo.dept_id,
      customer: {
        id: clientInfo.client_id,
        chat_group_id: chatGroupId,
        name: clientInfo.name,
        number: clientInfo.client_number,
        profile: clientInfo.profile_image,
        status: 'active',
        department: chatGroupInfo.department?.dept_name || 'Unknown',
      }
    };

    // Emit to the specific agent
    io.to(`agent_${agentId}`).emit('customerListUpdate', {
      type: 'new_assignment',
      data: customerUpdate
    });

    console.log(`📋 Sent new assignment to agent ${agentId} for chat ${chatGroupId}`);

  } catch (error) {
    console.error('❌ Error handling chat assignment update:', error);
  }
}

module.exports = {
  handleCustomerListUpdate,
  broadcastCustomerListUpdate,
  handleChatResolved,
  handleChatReactivated,
  handleChatAssignment,
  getChatGroupInfo,
  getClientInfo
};