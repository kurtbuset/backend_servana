# sms.to Integration

This project uses sms.to (app.sms.to) for sending OTP SMS messages.

## Setup

1. Create an account at [https://app.sms.to](https://app.sms.to)

2. Get your API key from the dashboard

3. Add to your `.env` file:
```env
SMS_TO_API_KEY=your_api_key_here
SMS_TO_SENDER_ID=SERVANA
```

4. The SMS service will automatically send OTPs when the API key is configured

## How It Works

- When `SMS_TO_API_KEY` is set, OTPs are sent via SMS
- When not set (development), OTPs are logged to console
- SMS sending errors are logged but don't block the OTP flow

## API Endpoint

sms.to API: `https://api.sms.to/sms/send`

## Message Format

```
Your Servana verification code is: [OTP]. Valid for 5 minutes.
```

## Testing

In development without API key:
- OTP will be logged to console
- No SMS will be sent

In production with API key:
- OTP will be sent via sms.to
- Console will show delivery status

## Phone Number Format

Phone numbers must include country code (e.g., +639171234567 for Philippines)

## Features

- Simple REST API
- No phone number registration required
- Pay-as-you-go pricing
- Global SMS delivery
