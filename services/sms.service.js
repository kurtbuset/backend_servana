const axios = require('axios');

const SEMAPHORE_API_URL = 'https://api.semaphore.co/api/v4/messages';

class SmsService {
  /**
   * Send SMS via Semaphore
   * @param {string} phoneNumber - Full phone number with country code (e.g., +639171234567)
   * @param {string} message - SMS message content
   * @returns {Promise<Object>} Response from Semaphore API
   */
  async sendSms(phoneNumber, message) {
    const apiKey = process.env.SEMAPHORE_API_KEY;
    const senderId = process.env.SEMAPHORE_SENDER_NAME;

    if (!apiKey) {
      throw new Error('SEMAPHORE_API_KEY is not configured');
    }

    try {
      // Semaphore expects phone number without + prefix
      const cleanPhoneNumber = phoneNumber.replace(/^\+/, '');

      const payload = {
        apikey: apiKey,
        number: cleanPhoneNumber,
        message: message,
      };

      // Only include sendername if it's configured
      // Note: Sender name must be registered in Semaphore dashboard first
      if (senderId) {
        payload.sendername = senderId;
      }

      const response = await axios.post(
        SEMAPHORE_API_URL,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      // console.log(`📱 SMS sent to ${phoneNumber}:`, response.data);
      return response.data;
    } catch (error) {
      const errorData = error.response?.data || error.message;
      console.error('SMS Service Error:', errorData);
      throw new Error(`Failed to send SMS: ${JSON.stringify(errorData)}`);
    }
  }

  /**
   * Send OTP SMS
   * @param {string} phoneCountryCode - Country code (e.g., +63)
   * @param {string} phoneNumber - Phone number without country code
   * @param {string} otp - OTP code
   */
  async sendOtpSms(phoneCountryCode, phoneNumber, otp) {
    const fullPhoneNumber = `${phoneCountryCode}${phoneNumber}`;
    const message = `Your Servana verification code is: ${otp}. Valid for 5 minutes.`;
        
    return await this.sendSms(fullPhoneNumber, message);
  }
}

module.exports = new SmsService();
