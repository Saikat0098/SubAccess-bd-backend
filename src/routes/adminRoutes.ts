import { Router, Request, Response } from 'express';
import { Order } from '../models/Order.js';
import { Payment } from '../models/Payment.js';
import { User } from '../models/User.js';
import { Product } from '../models/Product.js';
import { SupportTicket } from '../models/SupportTicket.js';
import { Settings } from '../models/Settings.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { protect, isAdmin, AuthRequest } from '../middleware/auth.js';
import orderRoutes from './orderRoutes.js';

const router = Router();

// Order sub-router mounted under /api/admin/orders
router.use('/orders', orderRoutes);

// @route GET /api/admin/analytics
router.get('/analytics', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    const pendingOrdersCount = await Order.countDocuments({ orderStatus: 'pending' });
    const pendingPaymentsCount = await Payment.countDocuments({ status: 'pending' });
    const pendingTicketsCount = await SupportTicket.countDocuments({ status: { $in: ['open', 'waiting_admin'] } });
    const totalCustomersCount = await User.countDocuments({ role: 'user' });
    const totalProductsCount = await Product.countDocuments({ isActive: true });

    // Today's revenue calculation (Verified Payments Created Today)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayOrders = await Order.find({
      paymentStatus: 'verified',
      createdAt: { $gte: startOfToday },
    });
    const todaysRevenueBDT = todayOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    // Monthly revenue calculation (Verified Payments Created This Month)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthOrders = await Order.find({
      paymentStatus: 'verified',
      createdAt: { $gte: startOfMonth },
    });
    const monthlyRevenueBDT = monthOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    // Total Lifetime Revenue
    const allVerifiedOrders = await Order.find({ paymentStatus: 'verified' });
    const totalRevenueBDT = allVerifiedOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    // Recent 10 orders
    const recentOrders = await Order.find().sort({ createdAt: -1 }).limit(10);

    // Recent 10 transactions / payments
    const recentTransactions = await Payment.find()
      .populate('user', 'name email phone')
      .populate('order', 'orderNumber totalAmount paymentMethod transactionId senderPhone customerName')
      .sort({ createdAt: -1 })
      .limit(10);

    // Verification Queue (Pending Payments)
    const verificationQueue = await Payment.find({ status: 'pending' })
      .populate('user', 'name email phone')
      .populate('order', 'orderNumber totalAmount paymentMethod transactionId senderPhone customerName')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      analytics: {
        pendingOrdersCount,
        pendingPaymentsCount,
        pendingTicketsCount,
        todaysRevenueBDT,
        monthlyRevenueBDT,
        totalRevenueBDT,
        totalCustomersCount,
        totalProductsCount,
      },
      recentOrders,
      recentTransactions,
      verificationQueue,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route GET /api/admin/activity-logs
router.get('/activity-logs', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    const logs = await ActivityLog.find()
      .populate('user', 'name email role')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ success: true, logs });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route GET /api/admin/users
router.get('/users', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PATCH /api/admin/users/:id/promote
router.patch('/users/:id/promote', protect, isAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.role = 'admin';
    await user.save();

    await ActivityLog.create({
      user: req.user?._id,
      userName: req.user?.name,
      action: 'User Promoted',
      details: `Promoted ${user.email} to Admin`,
    });

    res.json({ success: true, message: `Promoted ${user.name} to Admin`, user });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PATCH /api/admin/users/:id/demote
router.patch('/users/:id/demote', protect, isAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.role = 'user';
    await user.save();

    await ActivityLog.create({
      user: req.user?._id,
      userName: req.user?.name,
      action: 'User Demoted',
      details: `Demoted ${user.email} to User`,
    });

    res.json({ success: true, message: `Demoted ${user.name} to User`, user });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PATCH /api/admin/users/:id/toggle-block
router.patch('/users/:id/toggle-block', protect, isAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.isBlocked = !user.isBlocked;
    await user.save();

    res.json({
      success: true,
      message: `User ${user.isBlocked ? 'Blocked' : 'Unblocked'}`,
      user,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PATCH /api/admin/users/:id/reset-password
router.patch('/users/:id/reset-password', protect, isAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: `Password reset successfully for ${user.name}` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PATCH /api/admin/users/:id/verify-email
router.patch('/users/:id/verify-email', protect, isAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.isEmailVerified = true;
    await user.save();

    res.json({ success: true, message: `Email verified for ${user.name}`, user });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route DELETE /api/admin/users/:id
router.delete('/users/:id', protect, isAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({ success: true, message: 'User account deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PUT /api/admin/users/:id/role
router.put('/users/:id/role', protect, isAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role specified' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.role = role;
    await user.save();

    await ActivityLog.create({
      user: req.user?._id,
      userName: req.user?.name,
      action: 'Role Changed',
      details: `Changed user ${user.email} role to ${role}`,
    });

    res.json({ success: true, message: `User role updated to ${role}`, user });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route GET /api/admin/settings
router.get('/settings', async (req: Request, res: Response) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    res.json({ success: true, settings });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PUT /api/admin/settings
router.put('/settings', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings(req.body);
    } else {
      Object.assign(settings, req.body);
    }
    await settings.save();

    res.json({ success: true, message: 'Settings updated successfully', settings });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
