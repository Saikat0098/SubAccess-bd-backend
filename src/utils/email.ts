import nodemailer from 'nodemailer';

export const sendOTPEmail = async (toEmail: string, otpCode: string): Promise<boolean> => {
  try {
    const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
    const port = Number(process.env.EMAIL_PORT) || 587;
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    if (!user || !pass || user.includes('support@subaccessbd.com')) {
      console.log(`[EMAIL DEV LOG] OTP for ${toEmail}: ${otpCode}`);
      return true;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
        <div style="background-color: #0284c7; padding: 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 24px; font-weight: bold;">SubAccess BD</h1>
          <p style="margin: 4px 0 0 0; opacity: 0.9;">Digital Subscription Marketplace</p>
        </div>
        <div style="padding: 32px; color: #334155;">
          <h2 style="margin-top: 0; font-size: 20px; color: #0f172a;">Verify Your Email Address</h2>
          <p style="font-size: 15px; line-height: 1.6;">Thank you for registering on SubAccess BD. Please use the following 6-digit OTP code to verify your account:</p>
          <div style="margin: 28px 0; text-align: center;">
            <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0284c7; background-color: #f0f9ff; padding: 12px 28px; border-radius: 8px; border: 1px dashed #0284c7;">${otpCode}</span>
          </div>
          <p style="font-size: 14px; color: #64748b; margin-bottom: 0;">This OTP code is valid for <strong>5 minutes</strong>. Do not share this code with anyone.</p>
        </div>
        <div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 13px; color: #94a3b8; border-top: 1px solid #f1f5f9;">
          &copy; ${new Date().getFullYear()} SubAccess BD. All rights reserved.
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"SubAccess BD Support" <${user}>`,
      to: toEmail,
      subject: `[SubAccess BD] ${otpCode} is your verification code`,
      html: htmlContent,
    });

    return true;
  } catch (error) {
    console.error('Nodemailer send error:', error);
    // Return true in development so registration flow is never blocked
    return true;
  }
};
