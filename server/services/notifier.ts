import { Resend } from 'resend';
import twilio from 'twilio';
import { config } from '../config';

export interface SendOtpOptions {
  destination: string;
  code: string;
  handle: string;
  uin?: number;
}

export interface SendOtpResult {
  ok: boolean;
  channel: 'email' | 'sms' | 'console';
  message: string;
  error?: string;
}

/**
 * Checks if the identifier is a phone number rather than an email address.
 */
export function isPhoneNumber(identifier: string): boolean {
  const trimmed = identifier.trim();
  if (trimmed.includes('@')) return false;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Normalizes phone numbers into E.164 international format (e.g. +15550191996)
 */
export function formatToE164(raw: string): string {
  const trimmed = raw.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');

  if (trimmed.startsWith('+')) {
    return `+${digitsOnly}`;
  }

  // Standard 10-digit North American number without country code
  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }

  // 11-digit North American number starting with 1
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`;
  }

  return `+${digitsOnly}`;
}

/**
 * Sends a transactional 6-digit OTP email via Resend (or logs to console if unconfigured).
 */
async function sendEmailOtp(toEmail: string, code: string, handle: string, uin?: number): Promise<SendOtpResult> {
  const subject = `[:> NEOGRAM AUTH] Authorization Code: ${code}`;
  const uinText = uin ? ` (UIN: #${uin})` : '';

  const plainText = [
    '==================================================',
    '[:> NEOGRAM CARRIER HANDSHAKE // SYSTEM 7 AUTH]',
    '==================================================',
    '',
    `Greetings @${handle}${uinText},`,
    '',
    'Your 6-digit terminal authorization key is:',
    '',
    `                  [  ${code}  ]`,
    '',
    'This carrier signal expires in 10 minutes.',
    'If you did not initiate this terminal request, please disregard.',
    '',
    '-- NEOGRAM NETWORK TERMINAL // 90s RETRO SOCIAL ENGINE',
  ].join('\n');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Neogram Authentication Code</title>
      </head>
      <body style="background-color: #0d1117; color: #00ff66; font-family: 'Courier New', Courier, monospace; padding: 24px; margin: 0;">
        <div style="max-width: 520px; margin: 0 auto; background: #000000; border: 3px solid #00ff66; padding: 20px; box-shadow: 6px 6px 0px #003311;">
          <div style="border-bottom: 2px dashed #00ff66; padding-bottom: 10px; margin-bottom: 16px;">
            <span style="font-size: 16px; font-weight: bold; letter-spacing: 1px;">[:&gt; NEOGRAM TERMINAL AUTHENTICATION]</span>
          </div>

          <p style="color: #ffffff; font-size: 13px; line-height: 1.5;">
            Greetings <strong>@${handle}</strong>${uinText},
          </p>
          <p style="color: #999999; font-size: 12px; margin-bottom: 20px;">
            A dial-up session request was received for your cyberspace station. Enter the 6-digit authorization key below to unlock your terminal:
          </p>

          <div style="background-color: #001100; border: 2px solid #00ff66; padding: 18px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #00ff66; text-shadow: 0 0 10px rgba(0, 255, 102, 0.7);">
              ${code}
            </span>
          </div>

          <p style="color: #ffb000; font-size: 11px; margin-top: 16px;">
            [!] Key expires in 10 minutes. Transmit once to establish carrier link.
          </p>

          <div style="border-top: 1px solid #222; margin-top: 24px; padding-top: 12px; font-size: 10px; color: #555555;">
            NEOGRAM RETRO SOCIAL PUBLISHING ENGINE // PROTOCOL: OTP-PASSWORDLESS
          </div>
        </div>
      </body>
    </html>
  `;

  if (!config.resendApiKey) {
    console.log('[:> NOTIFIER INFO] No RESEND_API_KEY found. Dispatch logged to terminal:');
    console.log(`[:> EMAIL TO]: ${toEmail}`);
    console.log(`[:> 6-DIGIT CODE]: ${code}`);
    return {
      ok: true,
      channel: 'console',
      message: 'Logged code to development terminal (No RESEND_API_KEY).',
    };
  }

  try {
    const resend = new Resend(config.resendApiKey);
    const { data, error } = await resend.emails.send({
      from: config.emailFrom,
      to: [toEmail],
      subject,
      text: plainText,
      html,
    });

    if (error) {
      console.error('[:> RESEND ERROR]', error);
      return {
        ok: false,
        channel: 'email',
        message: `Failed to deliver email: ${error.message}`,
        error: error.message,
      };
    }

    console.log(`[:> RESEND SUCCESS] Dispatched OTP email to ${toEmail} (ID: ${data?.id})`);
    return {
      ok: true,
      channel: 'email',
      message: `Carrier authorization email dispatched to ${toEmail}.`,
    };
  } catch (err: any) {
    console.error('[:> RESEND EXCEPTION]', err);
    return {
      ok: false,
      channel: 'email',
      message: err.message || 'Email delivery failed.',
      error: err.message,
    };
  }
}

/**
 * Sends a transactional 6-digit OTP SMS via Twilio standard Programmable SMS.
 */
async function sendSmsOtp(toPhone: string, code: string, handle: string, uin?: number): Promise<SendOtpResult> {
  const formattedPhone = formatToE164(toPhone);
  const uinText = uin ? ` (#${uin})` : '';
  const messageBody = `[:> NEOGRAM AUTH] Your 6-digit authorization code is: ${code}. Terminal key for @${handle}${uinText}. Valid for 10 min.`;

  if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioPhoneNumber) {
    console.log('[:> NOTIFIER INFO] Twilio SMS keys not fully set in .env. Dispatch logged to terminal:');
    console.log(`[:> SMS TARGET]: ${formattedPhone}`);
    console.log(`[:> SMS TEXT]: ${messageBody}`);
    return {
      ok: true,
      channel: 'console',
      message: `Logged SMS code to terminal for ${formattedPhone} (No Twilio keys).`,
    };
  }

  try {
    const client = twilio(config.twilioAccountSid, config.twilioAuthToken);
    const msg = await client.messages.create({
      body: messageBody,
      from: config.twilioPhoneNumber,
      to: formattedPhone,
    });

    console.log(`[:> TWILIO SUCCESS] Sent SMS to ${formattedPhone} (SID: ${msg.sid}, Status: ${msg.status})`);
    return {
      ok: true,
      channel: 'sms',
      message: `Carrier SMS dispatched to ${formattedPhone}.`,
    };
  } catch (err: any) {
    console.error('[:> TWILIO ERROR]', err.message || err);
    return {
      ok: false,
      channel: 'sms',
      message: `SMS transmission failed: ${err.message}`,
      error: err.message,
    };
  }
}

/**
 * Primary dispatch router: intelligently chooses between Email (Resend) or SMS (Twilio).
 */
export async function sendOtpNotification(options: SendOtpOptions): Promise<SendOtpResult> {
  const { destination, code, handle, uin } = options;

  if (isPhoneNumber(destination)) {
    return sendSmsOtp(destination, code, handle, uin);
  }

  return sendEmailOtp(destination, code, handle, uin);
}
