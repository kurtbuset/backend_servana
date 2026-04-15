const supabase = require("../helpers/supabaseClient");

/**
 * Get profile images for multiple profile IDs - single query
 */
async function getProfileImages(profIds) {
  if (!profIds || profIds.length === 0) return {};

  const { data: images, error } = await supabase
    .from("image")
    .select("prof_id, img_location, img_is_current, img_created_at")
    .in("prof_id", profIds)
    .order("prof_id, img_is_current, img_created_at");

  if (error) throw error;

  const imageMap = {};
  const processedProfiles = new Set();

  (images || []).forEach((img) => {
    if (!processedProfiles.has(img.prof_id)) {
      imageMap[img.prof_id] = img.img_location;
      processedProfiles.add(img.prof_id);
    }
  });

  return imageMap;
}

/**
 * Get latest message timestamp for chat groups
 */
async function getLatestMessageTimes(chatGroupIds) {
  if (!chatGroupIds || chatGroupIds.length === 0) return {};

  const { data: messages, error } = await supabase
    .from("chat")
    .select("chat_group_id, chat_created_at")
    .in("chat_group_id", chatGroupIds)
    .not("client_id", "is", null)
    .order("chat_created_at", { ascending: false });

  if (error) throw error;

  const timeMap = {};
  const processedGroups = new Set();

  (messages || []).forEach((msg) => {
    if (!processedGroups.has(msg.chat_group_id)) {
      timeMap[msg.chat_group_id] = msg.chat_created_at;
      processedGroups.add(msg.chat_group_id);
    }
  });

  return timeMap;
}

/**
 * Get unread message counts for chat groups
 * Returns a map of chat_group_id -> boolean (true if has unread messages from client)
 * Only checks active chat groups, not resolved ones
 * Optimized with a single query using JOIN
 */
async function getUnreadMessageStatus(chatGroupIds) {
  if (!chatGroupIds || chatGroupIds.length === 0) return {};

  // Single optimized query: get unread messages only from active chat groups
  // Uses implicit JOIN through foreign key relationship
  const { data: unreadMessages, error } = await supabase
    .from("chat")
    .select(`
      chat_group_id,
      chat_group!inner(status)
    `)
    .in("chat_group_id", chatGroupIds)
    .not("client_id", "is", null) // Only client messages
    .is("chat_read_at", null) // Not read yet
    .eq("chat_group.status", "active"); // Only active chat groups

  if (error) throw error;

  const unreadMap = {};
  
  // Initialize all chat groups as no unread
  chatGroupIds.forEach(id => {
    unreadMap[id] = false;
  });

  // Mark chat groups with unread messages
  const processedGroups = new Set();
  (unreadMessages || []).forEach((msg) => {
    if (!processedGroups.has(msg.chat_group_id)) {
      unreadMap[msg.chat_group_id] = true;
      processedGroups.add(msg.chat_group_id);
    }
  });

  return unreadMap;
}

/**
 * Determine the type of message sender
 */
function determineSenderType(message, currentUserId) {
  if (message.client_id && !message.sys_user_id) {
    return 'client';
  } else if (message.sys_user_id) {
    if (currentUserId && message.sys_user_id === currentUserId) {
      return 'current_agent';
    } else {
      return 'previous_agent';
    }
  }
  return 'system';
}

/**
 * Get sender display name
 */
function getSenderName(message) {
  if (message.client_id && !message.sys_user_id) {
    return 'Client';
  } else if (message.sys_user_id && message.sys_user?.profile) {
    const firstName = message.sys_user.profile.prof_firstname || '';
    const lastName = message.sys_user.profile.prof_lastname || '';
    return `${firstName} ${lastName}`.trim() || 'Agent';
  } else if (message.sys_user_id) {
    return 'Agent';
  }
  return 'System';
}

/**
 * Get sender profile image using joined data
 */
function getSenderImageOptimized(message) {
  if (message.client_id && !message.sys_user_id && message.client?.profile?.image) {
    const images = message.client.profile.image || [];
    const currentImage = images.find(img => img.img_is_current);
    return currentImage?.img_location || null;
  } else if (message.sys_user_id && message.sys_user?.profile?.image) {
    const images = message.sys_user.profile.image || [];
    const currentImage = images.find(img => img.img_is_current);
    return currentImage?.img_location || null;
  }
  return null;
}

module.exports = {
  getProfileImages,
  getLatestMessageTimes,
  getUnreadMessageStatus,
  determineSenderType,
  getSenderName,
  getSenderImageOptimized,
};
