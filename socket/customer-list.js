/**
 * Customer List Management
 * Handles real-time customer list updates for agents
 */

const supabase = require("../helpers/supabaseClient");

/**
 * Get chat group information
 */
async function getChatGroupInfo(chatGroupId) {
  try {
    const { data, error } = await supabase
      .from("chat_group")
      .select(
        `
        chat_group_id,
        client_id,
        dept_id,
        sys_user_id,
        status,
        created_at,
        department:dept_id (
          dept_name
        )
      `,
      )
      .eq("chat_group_id", chatGroupId)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("❌ Error fetching chat group info:", error);
    return null;
  }
}

/**
 * Get client information
 */
async function getClientInfo(clientId) {
  try {
    const { data, error } = await supabase
      .from("client")
      .select(
        `
        client_id,
        client_number,
        prof_id,
        profile:prof_id (
          prof_firstname,
          prof_lastname
        )
      `,
      )
      .eq("client_id", clientId)
      .single();

    if (error) throw error;

    return {
      client_id: data.client_id,
      client_number: data.client_number,
      name: data.profile
        ? `${data.profile.prof_firstname} ${data.profile.prof_lastname}`.trim()
        : "Unknown",
      profile_image: data.profile?.prof_image || null,
    };
  } catch (error) {
    console.error("❌ Error fetching client info:", error);
    return null;
  }
}

/**
 * Build customerListUpdate payload
 */
function buildCustomerUpdate(type, chatGroupInfo, clientInfo, agentId) {
  // Determine chat_type based on status
  const chat_type = chatGroupInfo.status === "queued" ? "queued" : "active";

  return {
    type,
    data: {
      customer: {
        chat_group_id: chatGroupInfo.chat_group_id,
        name: clientInfo.name,
        number: clientInfo.client_number,
        profile: clientInfo.profile_image,
        status: chatGroupInfo.status,
        chat_type: chat_type,
        department: chatGroupInfo.department?.dept_name || "Unknown",
        sys_user_id: chatGroupInfo.sys_user_id,
        dept_id: chatGroupInfo.dept_id,
        created_at: chatGroupInfo.created_at,
      },
      agentId: agentId || null,
      chat_group_id: chatGroupInfo.chat_group_id,
      accepted_by: agentId || null,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Handle new chat assignment (auto-assigned via round-robin)
 * Emits customerListUpdate with type 'assigned' only to the assigned agent
 */
async function handleChatAssignment(io, chatGroupId, agentId) {
  try {
    const chatGroupInfo = await getChatGroupInfo(chatGroupId);
    if (!chatGroupInfo) return;

    const clientInfo = await getClientInfo(chatGroupInfo.client_id);
    if (!clientInfo) return;

    const payload = buildCustomerUpdate(
      "assigned",
      chatGroupInfo,
      clientInfo,
      agentId,
    );
    console.log("payload: ", JSON.stringify(payload, null, 2));

    // Emit only to the assigned agent
    const agentRoom = `user_${agentId}`;
    io.to(agentRoom).emit("customerListUpdate", payload);

    console.log(
      `📋 customerListUpdate: assigned chat ${chatGroupId} to agent ${agentId} (room: ${agentRoom})`,
    );
  } catch (error) {
    console.error("❌ Error handling chat assignment update:", error);
  }
}

/**
 * Handle chat queued (no available agents)
 * Emits customerListUpdate with type 'new_queued_chat' only to agents in the same department
 * Includes not_accepting_chats agents so they can manually accept from web
 */
async function handleChatQueued(io, chatGroupId, deptId) {
  try {
    const chatGroupInfo = await getChatGroupInfo(chatGroupId);
    if (!chatGroupInfo) return;

    const clientInfo = await getClientInfo(chatGroupInfo.client_id);
    if (!clientInfo) return;

    const payload = buildCustomerUpdate(
      "new_queued_chat",
      chatGroupInfo,
      clientInfo,
      null,
    );

    console.log(
      "📋 new_queued_chat payload:",
      JSON.stringify(payload, null, 2),
    );

    // Emit only to agents in the same department
    const departmentRoom = `department_${deptId}`;

    io.to(departmentRoom).emit("customerListUpdate", payload);

    console.log(
      `📋 customerListUpdate: new_queued_chat ${chatGroupId} in dept ${deptId} (room: ${departmentRoom})`,
    );
  } catch (error) {
    console.error("❌ Error handling chat queued update:", error);
  }
}

/**
 * Handle chat manually accepted from queue
 */
async function handleChatAccepted(io, chatGroupId, agentId) {
  try {
    const chatGroupInfo = await getChatGroupInfo(chatGroupId);
    if (!chatGroupInfo) return;

    const clientInfo = await getClientInfo(chatGroupInfo.client_id);
    if (!clientInfo) return;

    const payload = buildCustomerUpdate(
      "remove_chat_group",
      chatGroupInfo,
      clientInfo,
      agentId,
    );
    io.emit("customerListUpdate", payload);

  } catch (error) {
    console.error("❌ Error handling chat accepted update:", error);
  }
}

module.exports = {
  handleChatAssignment,
  handleChatQueued,
  handleChatAccepted,
  getChatGroupInfo,
  getClientInfo,
};
