const supabase = require('../../helpers/supabaseClient');

/**
 * Helper functions for client operations
 */
class ClientHelper {
  /**
   * Get client information including profile
   * @param {number} clientId - Client ID
   * @returns {Promise<Object|null>} Client info or null
   */
  async getClientInfo(clientId) {
    try {
      const { data: client, error } = await supabase
        .from('client')
        .select(`
          client_id,
          client_number,
          prof_id,
          profile:prof_id (
            prof_firstname,
            prof_lastname
          )
        `)
        .eq('client_id', clientId)
        .single();

      if (error || !client) {
        throw new Error('Client not found');
      }

      // Get profile image
      let profileImage = null;
      if (client.prof_id) {
        const { data: image } = await supabase
          .from('image')
          .select('img_location')
          .eq('prof_id', client.prof_id)
          .eq('img_is_current', true)
          .single();
        
        profileImage = image?.img_location || null;
      }

      const fullName = client.profile
        ? `${client.profile.prof_firstname} ${client.profile.prof_lastname}`.trim()
        : "Unknown Client";

      return {
        client_id: client.client_id,
        client_number: client.client_number,
        name: fullName,
        profile_image: profileImage
      };
    } catch (error) {
      console.error('❌ Error getting client info:', error);
      return null;
    }
  }
}

module.exports = new ClientHelper();
