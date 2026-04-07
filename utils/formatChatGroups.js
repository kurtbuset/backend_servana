/**
 * Shared chat group formatting utility.
 * Used by chat.controller.js and queue.controller.js to avoid duplicate formatting logic.
 *
 * @param {Array} groups - Raw chat group rows from the database
 * @param {Object} imageMap - Map of prof_id → image URL
 * @param {Object} timeMap - Map of chat_group_id → latest message ISO timestamp
 * @param {Object} options
 * @param {string}  [options.status]      - Fixed status value (e.g., "active", "resolved"). If omitted, uses group.status.
 * @param {number}  [options.sysUserId]   - If provided, added as sys_user_id to each entry.
 * @param {boolean} [options.isAccepted]  - If provided, added as isAccepted to each customer object.
 * @returns {Array} Formatted and sorted chat group array (newest message first).
 */
function formatChatGroups(groups, imageMap, timeMap, options = {}) {
  const formatted = [];

  for (const group of groups) {
    const client = group.client;
    if (!client) continue;

    const fullName = client.profile
      ? `${client.profile.prof_firstname} ${client.profile.prof_lastname}`.trim()
      : "Unknown Client";

    const latestTime = timeMap[group.chat_group_id];
    const displayTime = latestTime
      ? new Date(latestTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const customer = {
      id: client.client_id,
      chat_group_id: group.chat_group_id,
      name: fullName,
      number: client.client_number,
      profile: imageMap[client.prof_id] || null,
      time: displayTime,
      status: options.status !== undefined ? options.status : group.status,
    };

    if (options.isAccepted !== undefined) {
      customer.isAccepted = options.isAccepted;
    }
    if (options.sysUserId !== undefined) {
      customer.sys_user_id = group.sys_user_id;
    }

    const entry = {
      chat_group_id: group.chat_group_id,
      chat_group_name: fullName,
      department: group.department?.dept_name || "Unknown",
      customer,
      latestMessageTime: latestTime || new Date().toISOString(),
    };

    if (options.sysUserId !== undefined) {
      entry.sys_user_id = options.sysUserId;
    }

    formatted.push(entry);
  }

  return formatted
    .sort((a, b) => new Date(b.latestMessageTime) - new Date(a.latestMessageTime))
    .map(({ latestMessageTime, ...rest }) => rest);
}

module.exports = { formatChatGroups };
