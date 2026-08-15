import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { OTP } from '../models/OTP.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { sendOTPEmail } from '../utils/email.js';
import { protect, AuthRequest } from '../middleware/auth.js';

const router = Router();

const generateTokens = (userId: string) => {
  const jwtSecret = process.env.JWT_SECRET || 'subaccess_jwt_secret_key_2026_production';
  const refreshSecret = process.env.JWT_REFRESH_SECRET || 'subaccess_refresh_secret_key_2026_production';

  const accessToken = jwt.sign({ id: userId }, jwtSecret, { expiresIn: '7d' });
  const refreshToken = jwt.sign({ id: userId }, refreshSecret, { expiresIn: '30d' });

  return { accessToken, refreshToken };
};

// @route   POST /api/auth/register
// @desc    User registration with email duplicate check, optional OTP verification or instant JWT login
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Check if email already exists in MongoDB
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already registered.' });
    }

    // Default first user as admin if database is empty, else regular user
    const count = await User.countDocuments();
    const role = count === 0 ? 'admin' : 'user';

    const hasRealSmtp = Boolean(
      process.env.EMAIL_USER &&
      process.env.EMAIL_PASS &&
      !process.env.EMAIL_USER.includes('support@subaccessbd.com') &&
      process.env.REQUIRE_EMAIL_VERIFICATION === 'true'
    );

    if (hasRealSmtp) {
      // OPTION A: Email OTP verification workflow
      const user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        password,
        phone: phone ? phone.trim() : '',
        role,
        isEmailVerified: false,
      });

      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      await OTP.deleteMany({ email: user.email });
      await OTP.create({ email: user.email, otpCode, expiresAt });

      await sendOTPEmail(user.email, otpCode);

      return res.status(201).json({
        success: true,
        requiresVerification: true,
        message: 'Registration successful! Verification code sent to your email.',
        email: user.email,
      });
    } else {
      // OPTION B (Fallback): Instant account creation & automatic JWT login
      const user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        password,
        phone: phone ? phone.trim() : '',
        role,
        isEmailVerified: true,
      });

      const tokens = generateTokens(user._id.toString());
      user.refreshToken = tokens.refreshToken;
      await user.save();

      await ActivityLog.create({
        user: user._id,
        userName: user.name,
        action: 'Account Registration',
        ipAddress: req.ip,
        details: `Registered account via Email (${user.email})`,
      });

      return res.status(201).json({
        success: true,
        requiresVerification: false,
        message: 'Account created successfully!',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
          phone: user.phone,
          avatar: user.avatar,
        },
        tokens,
      });
    }
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Email already registered.' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/auth/verify-otp
router.post('/verify-otp', async (req: Request, res: Response) => {
  try {
    const { email, otpCode } = req.body;

    if (!email || !otpCode) {
      return res.status(400).json({ success: false, message: 'Email and verification code are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const otpRecord = await OTP.findOne({ email: normalizedEmail, otpCode: otpCode.trim() });

    if (!otpRecord) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.isEmailVerified = true;
    await user.save();

    await OTP.deleteMany({ email: user.email });

    const tokens = generateTokens(user._id.toString());
    user.refreshToken = tokens.refreshToken;
    await user.save();

    res.json({
      success: true,
      message: 'Email verified successfully!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        phone: user.phone,
        avatar: user.avatar,
      },
      tokens,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/auth/resend-otp
router.post('/resend-otp', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await OTP.deleteMany({ email: user.email });
    await OTP.create({ email: user.email, otpCode, expiresAt });

    await sendOTPEmail(user.email, otpCode);

    res.json({
      success: true,
      message: 'A new 6-digit verification code has been sent to your email.',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const tokens = generateTokens(user._id.toString());
    user.refreshToken = tokens.refreshToken;
    await user.save();

    await ActivityLog.create({
      user: user._id,
      userName: user.name,
      action: 'User Login',
      ipAddress: req.ip,
      details: `Logged in via Email (${user.email})`,
    });

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        phone: user.phone,
        avatar: user.avatar,
      },
      tokens,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/auth/refresh-token
router.post('/refresh-token', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token is required' });
    }

    const refreshSecret = process.env.JWT_REFRESH_SECRET || 'subaccess_refresh_secret_key_2026_production';
    const decoded = jwt.verify(refreshToken, refreshSecret) as { id: string };

    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ success: false, message: 'Invalid or revoked refresh token' });
    }

    const tokens = generateTokens(user._id.toString());
    user.refreshToken = tokens.refreshToken;
    await user.save();

    res.json({
      success: true,
      tokens,
    });
  } catch (error: any) {
    res.status(401).json({ success: false, message: 'Expired or invalid refresh token' });
  }
});

// @route   POST /api/auth/google
router.post('/google', async (req: Request, res: Response) => {
  try {
    const { name, email, googleId, avatar } = req.body;

    if (!email || !googleId) {
      return res.status(400).json({ success: false, message: 'Google authentication data incomplete' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      const count = await User.countDocuments();
      const role = count === 0 ? 'admin' : 'user';

      user = await User.create({
        name: name || 'Google User',
        email: normalizedEmail,
        googleId,
        avatar: avatar || '',
        role,
        isEmailVerified: true,
      });
    } else {
      user.googleId = googleId;
      if (avatar) user.avatar = avatar;
      user.isEmailVerified = true;
      await user.save();
    }

    const tokens = generateTokens(user._id.toString());
    user.refreshToken = tokens.refreshToken;
    await user.save();

    res.json({
      success: true,
      message: 'Google login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        phone: user.phone,
        avatar: user.avatar,
      },
      tokens,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/auth/me
router.get('/me', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    res.json({
      success: true,
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        isEmailVerified: req.user.isEmailVerified,
        phone: req.user.phone,
        avatar: req.user.avatar,
        address: (req.user as any).address || '',
        createdAt: req.user.createdAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/auth/profile
router.put('/profile', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const { name, phone, avatar, address } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (name) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (avatar !== undefined) user.avatar = avatar;
    if (address !== undefined) (user as any).address = address;

    await user.save();

    await ActivityLog.create({
      user: user._id,
      userName: user.name,
      action: 'Profile Updated',
      details: 'User updated profile information',
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        phone: user.phone,
        avatar: user.avatar,
        address: (user as any).address || '',
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/auth/change-password
router.post('/change-password', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new password are required' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user.password) {
      const isMatch = await user.matchPassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Incorrect current password' });
      }
    }

    user.password = newPassword;
    await user.save();

    await ActivityLog.create({
      user: user._id,
      userName: user.name,
      action: 'Password Changed',
      details: 'User changed account password',
    });

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;