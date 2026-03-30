const axios = require('axios');

const SMS_TO_API_URL = 'https://api.sms.to/sms/send';

class SmsService {
  /**
   * Send SMS via sms.to
   * @param {string} phoneNumber - Full phone number with country code (e.g., +639171234567)
   * @param {string} message - SMS message content
   * @returns {Promise<Object>} Response from sms.to API
   */
  async sendSms(phoneNumber, message) {
    const apiKey = process.env.SMS_TO_API_KEY;
    const senderId = process.env.SMS_TO_SENDER_ID;

    if (!apiKey) {
      throw new Error('SMS_TO_API_KEY is not configured');
    }

    try {
      const payload = {
        message: message,
        to: phoneNumber,
      };

      // Only include sender_id if it's configured and valid (alphanumeric and spaces only)
      if (senderId && /^[a-zA-Z0-9\s]+$/.test(senderId)) {
        payload.sender_id = senderId;
      }

      const response = await axios.post(
        SMS_TO_API_URL,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log(`📱 SMS sent to ${phoneNumber}:`, response.data);
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
