import { Router, Response } from 'express';
import { Payment } from '../models/Payment.js';
import { Order } from '../models/Order.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { Notification } from '../models/Notification.js';
import { protect, isAdmin, AuthRequest } from '../middleware/auth.js';
import { getIO } from '../socket.js';

const router = Router();

// @route GET /api/payments (Admin)
router.get('/', protect, isAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { status, search } = req.query;
    let filter: any = {};

    if (status) filter.status = status;

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      filter.$or = [
        { transactionId: { $regex: q, $options: 'i' } },
        { senderPhone: { $regex: q, $options: 'i' } },
        { paymentMethod: { $regex: q, $options: 'i' } },
      ];
    }

    const payments = await Payment.find(filter)
      .populate('user', 'name email phone')
      .populate('order', 'orderNumber totalAmount paymentStatus orderStatus customerName customerEmail customerPhone items createdAt paymentScreenshot senderPhone paymentMethod transactionId')
      .sort({ createdAt: -1 });

    res.json({ success: true, payments });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PUT /api/payments/:id/approve (Admin)
router.put('/:id/approve', protect, isAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { deliveredCredentials, deliveryInstructions, adminNotes } = req.body;

    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment record not found' });

    payment.status = 'verified';
    payment.verifiedBy = req.user?._id;
    payment.verifiedAt = new Date();
    if (adminNotes) payment.adminNotes = adminNotes;
    await payment.save();

    // Update associated Order
    const order = await Order.findById(payment.order);
    if (order) {
      order.paymentStatus = 'verified';
      order.orderStatus = 'completed';
      order.deliveryStatus = 'delivered';
      if (deliveredCredentials) order.deliveredCredentials = deliveredCredentials;
      if (deliveryInstructions) order.deliveryInstructions = deliveryInstructions;
      if (adminNotes) order.adminNotes = adminNotes;
      order.verifiedBy = req.user?._id;
      order.completedAt = new Date();
      await order.save();

      // Execute Secondary Non-Critical Background Tasks (Logs, Notifications, Sockets) Safely
      (async () => {
        try {
          await ActivityLog.create({
            user: req.user?._id,
            userName: req.user?.name,
            action: 'Payment Approved',
            details: `Approved payment for TrxID ${payment.transactionId} (Order #${order.orderNumber})`,
          });

          await Notification.create({
            user: order.user,
            title: '🎉 Payment Verified & Order Delivered!',
            message: `Your payment for order #${order.orderNumber} has been verified. Login credentials are available in your account.`,
            type: 'order',
            link: '/user/orders',
          });

          const io = getIO();
          if (io) {
            const pendingOrdersCount = await Order.countDocuments({ orderStatus: 'pending' });
            const pendingPaymentsCount = await Payment.countDocuments({ status: 'pending' });

            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const todayOrders = await Order.find({ paymentStatus: 'verified', createdAt: { $gte: startOfToday } });
            const todaysRevenueBDT = todayOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);
            const monthOrders = await Order.find({ paymentStatus: 'verified', createdAt: { $gte: startOfMonth } });
            const monthlyRevenueBDT = monthOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

            const allVerifiedOrders = await Order.find({ paymentStatus: 'verified' });
            const totalRevenueBDT = allVerifiedOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

            const socketPayload = {
              paymentId: payment._id,
              orderId: order._id,
              orderNumber: order.orderNumber,
              status: 'verified',
              pendingOrdersCount,
              pendingPaymentsCount,
              todaysRevenueBDT,
              monthlyRevenueBDT,
              totalRevenueBDT,
            };

            io.to('admin_room').emit('payment-approved', socketPayload);
            io.to('admin_room').emit('pending-order-count', { pendingOrdersCount, pendingPaymentsCount });
            io.to('admin_room').emit('dashboard-update', socketPayload);
            io.to(`user_${order.user}`).emit('payment-approved', socketPayload);
            io.to(`user_${order.user}`).emit('order:updated', {
              orderId: order._id,
              orderNumber: order.orderNumber,
              status: 'completed',
            });
          }
        } catch (secondaryErr) {
          console.error('Non-critical secondary task error on payment approval:', secondaryErr);
        }
      })();
    }

    res.json({ success: true, message: 'Payment approved successfully', payment, order });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PUT /api/payments/:id/reject (Admin)
router.put('/:id/reject', protect, isAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { rejectionReason } = req.body;
    const reason = rejectionReason || 'Invalid Transaction ID or payment not received.';

    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment record not found' });

    payment.status = 'rejected';
    payment.rejectionReason = reason;
    payment.adminNotes = reason;
    payment.verifiedBy = req.user?._id;
    await payment.save();

    const order = await Order.findById(payment.order);
    if (order) {
      order.paymentStatus = 'rejected';
      order.orderStatus = 'cancelled';
      order.deliveryStatus = 'cancelled';
      order.adminNotes = reason;
      await order.save();

      (async () => {
        try {
          await ActivityLog.create({
            user: req.user?._id,
            userName: req.user?.name,
            action: 'Payment Rejected',
            details: `Rejected payment TrxID ${payment.transactionId} for Order #${order.orderNumber}. Reason: ${reason}`,
          });

          await Notification.create({
            user: order.user,
            title: '❌ Payment Rejected',
            message: `Your payment for order #${order.orderNumber} was rejected. Reason: ${reason}`,
            type: 'order',
            link: '/user/orders',
          });

          const io = getIO();
          if (io) {
            const pendingOrdersCount = await Order.countDocuments({ orderStatus: 'pending' });
            const pendingPaymentsCount = await Payment.countDocuments({ status: 'pending' });

            const socketPayload = {
              paymentId: payment._id,
              orderId: order._id,
              orderNumber: order.orderNumber,
              status: 'rejected',
              reason,
              pendingOrdersCount,
              pendingPaymentsCount,
            };

            io.to('admin_room').emit('payment-rejected', socketPayload);
            io.to('admin_room').emit('pending-order-count', { pendingOrdersCount, pendingPaymentsCount });
            io.to('admin_room').emit('dashboard-update', socketPayload);
            io.to(`user_${order.user}`).emit('payment-rejected', socketPayload);
          }
        } catch (secondaryErr) {
          console.error('Non-critical secondary task error on payment rejection:', secondaryErr);
        }
      })();
    }

    res.json({ success: true, message: 'Payment rejected successfully', payment, order });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;