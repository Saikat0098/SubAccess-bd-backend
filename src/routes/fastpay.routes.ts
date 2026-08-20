import { Router, Request, Response } from 'express';
import FastPay, { FastPayApiError } from '../utils/fastpay.js';
import { Order } from '../models/Order.js';
import { Payment } from '../models/Payment.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { Notification } from '../models/Notification.js';
import { protect, AuthRequest } from '../middleware/auth.js';
import { getIO } from '../socket.js';

const router = Router();

const getFastPayInstance = () => new FastPay();

// @route GET /api/fastpay/test (Health check connection to Fast Pay gateway)
router.get('/test', async (_req: Request, res: Response) => {
  try {
    const fastpay = getFastPayInstance();
    try {
      await fastpay.getPaymentStatus('cs_test_health_probe');
    } catch (apiErr: any) {
      // If gateway responded with 404 (session not found) or 400, gateway is reachable and actively responding
      if (apiErr?.status && apiErr.status < 500) {
        return res.json({
          success: true,
          message: 'Fast Pay connection successful',
          gatewayUrl: fastpay.baseUrl,
        });
      }
      throw apiErr;
    }

    return res.json({
      success: true,
      message: 'Fast Pay connection successful',
      gatewayUrl: fastpay.baseUrl,
    });
  } catch (error: unknown) {
    const err = error as FastPayApiError;
    const status = err.status || 500;
    const message = err.message || 'An unexpected error occurred connecting to Fast Pay';
    const code = err.code || 'API_ERROR';

    return res.status(status).json({
      success: false,
      message,
      code,
    });
  }
});

// @route POST /api/fastpay/create-checkout (Create Fast Pay checkout session for an existing Order)
router.post('/create-checkout', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'orderId is required' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Verify order ownership
    if (req.user.role !== 'admin' && order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to create checkout for this order' });
    }

    // Prevent creating checkout session for already completed/verified order
    if (order.paymentStatus === 'verified' || order.orderStatus === 'completed') {
      return res.status(400).json({ success: false, message: 'Order is already paid and verified' });
    }

    // Server-side authoritative total amount
    const amount = Number(order.totalAmount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid order amount' });
    }

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5174').replace(/\/+$/, '');
    const returnUrl = `${frontendUrl}/user/orders`;
    const cancelUrl = `${frontendUrl}/checkout`;

    const fastpay = getFastPayInstance();
    const sessionResult = await fastpay.createCheckout({
      orderId: order._id.toString(),
      amount,
      currency: 'BDT',
      customerName: order.customerName || req.user.name,
      customerPhone: order.customerPhone || req.user.phone || '',
      returnUrl,
      cancelUrl,
    });

    // Store fastpaySessionId on Order
    order.fastpaySessionId = sessionResult.sessionId;
    order.paymentProvider = 'FastPay';
    order.paymentMethod = 'FastPay';
    await order.save();

    // Authoritative hosted checkout URL
    const checkoutHost = (process.env.FASTPAY_CHECKOUT_URL || '').replace(/\/+$/, '');
    const checkoutUrl =
      sessionResult.checkoutUrl ||
      (checkoutHost
        ? `${checkoutHost}/checkout/session/${sessionResult.sessionId}`
        : `http://localhost:5000/checkout/session/${sessionResult.sessionId}`);

    return res.json({
      success: true,
      sessionId: sessionResult.sessionId,
      checkoutUrl,
      orderId: order._id,
      amount: order.totalAmount,
    });
  } catch (error: unknown) {
    const err = error as FastPayApiError;
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Failed to create Fast Pay checkout session',
      code: err.code || 'CHECKOUT_ERROR',
    });
  }
});

// @route POST /api/fastpay/verify-payment (Verify Fast Pay checkout payment and update Order status)
router.post('/verify-payment', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const { sessionId, transactionId, orderId } = req.body;
    if (!sessionId && !orderId) {
      return res.status(400).json({ success: false, message: 'sessionId or orderId is required' });
    }

    let order = sessionId ? await Order.findOne({ fastpaySessionId: sessionId }) : null;
    if (!order && orderId) {
      order = await Order.findById(orderId);
    }

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order associated with session not found' });
    }

    // Authorization check
    if (req.user.role !== 'admin' && order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to verify payment for this order' });
    }

    // Idempotency check: if order is already verified
    if (order.paymentStatus === 'verified') {
      const existingPayment = await Payment.findOne({ order: order._id });
      return res.json({
        success: true,
        message: 'Order payment is already verified',
        order,
        payment: existingPayment,
      });
    }

    const fastpay = getFastPayInstance();
    const effectiveSessionId = sessionId || order.fastpaySessionId;
    if (!effectiveSessionId) {
      return res.status(400).json({ success: false, message: 'No Fast Pay session associated with this order' });
    }

    let actualTrxId = '';
    let provider = 'FastPay';

    if (transactionId) {
      const normalizedTrxId = String(transactionId).trim().toUpperCase();

      // Check duplicate transaction ID across verified orders
      const duplicateTrxOrder = await Order.findOne({
        transactionId: normalizedTrxId,
        paymentStatus: 'verified',
        _id: { $ne: order._id },
      });
      if (duplicateTrxOrder) {
        return res.status(400).json({
          success: false,
          message: 'Transaction ID has already been used for another verified order',
        });
      }

      // Call Fast Pay SDK verification
      const verifyResult = await fastpay.verifyPayment({
        sessionId: effectiveSessionId,
        transactionId: normalizedTrxId,
      });

      if (!verifyResult || !verifyResult.success) {
        return res.status(400).json({
          success: false,
          message: 'Payment verification failed with Fast Pay gateway',
        });
      }

      actualTrxId = verifyResult.transactionId || normalizedTrxId;
      provider = verifyResult.provider || 'FastPay';
    } else {
      // Query Fast Pay gateway session status
      const sessionStatus = await fastpay.getPaymentStatus(effectiveSessionId);
      if (sessionStatus.status !== 'COMPLETED' && sessionStatus.status !== 'VERIFIED') {
        return res.status(400).json({
          success: false,
          message: `Fast Pay checkout session status is '${sessionStatus.status}'. Payment is not yet completed.`,
        });
      }

      actualTrxId = sessionStatus.transactionId || order.transactionId || '';
      provider = sessionStatus.provider || 'FastPay';
    }

    // Update Order: payment is verified, fulfillment/delivery is pending admin processing
    order.transactionId = actualTrxId;
    order.paymentProvider = provider;
    order.paymentMethod = 'FastPay';
    order.paymentStatus = 'verified';
    order.orderStatus = 'processing';
    order.deliveryStatus = 'pending';
    await order.save();

    // Upsert Payment record
    const payment = await Payment.findOneAndUpdate(
      { order: order._id },
      {
        order: order._id,
        user: order.user,
        paymentMethod: 'FastPay',
        transactionId: actualTrxId,
        senderPhone: order.customerPhone || req.user.phone || '',
        amount: order.totalAmount,
        status: 'verified',
        verifiedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    // Secondary background tasks
    (async () => {
      try {
        await ActivityLog.create({
          user: req.user?._id,
          userName: req.user?.name,
          action: 'FastPay Payment Verified',
          details: `Fast Pay payment verified (TrxID ${actualTrxId}) for Order #${order.orderNumber} (৳${order.totalAmount})`,
        });

        await Notification.create({
          user: order.user,
          title: '🎉 Payment Completed!',
          message: `Payment completed successfully for order #${order.orderNumber}. Please wait while our admin prepares your subscription credentials.`,
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
            status: 'verified',
            paymentStatus: 'verified',
            orderStatus: 'processing',
            deliveryStatus: 'pending',
            transactionId: actualTrxId,
            pendingOrdersCount,
            pendingPaymentsCount,
          };

          io.to('admin_room').emit('payment-approved', socketPayload);
          io.to('admin_room').emit('dashboard-update', socketPayload);
          io.to(`user_${order.user}`).emit('payment-approved', socketPayload);
          io.to(`user_${order.user}`).emit('order:updated', {
            orderId: order._id,
            orderNumber: order.orderNumber,
            status: 'processing',
            paymentStatus: 'verified',
            deliveryStatus: 'pending',
            transactionId: actualTrxId,
          });
        }
      } catch (secErr) {
        console.error('Secondary error during Fast Pay verification:', secErr);
      }
    })();

    return res.json({
      success: true,
      message: 'Payment completed successfully. Please wait while our admin prepares your subscription credentials.',
      order,
      payment,
    });
  } catch (error: unknown) {
    const err = error as FastPayApiError;
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Payment verification failed',
      code: err.code || 'VERIFY_ERROR',
    });
  }
});

// @route GET /api/fastpay/sync-session/:sessionId (Sync order status from authoritative gateway session)
router.get('/sync-session/:sessionId', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    const order = await Order.findOne({ fastpaySessionId: sessionId });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order associated with session not found' });
    }

    if (req.user && req.user.role !== 'admin' && order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // If already verified, return current state
    if (order.paymentStatus === 'verified') {
      const payment = await Payment.findOne({ order: order._id });
      return res.json({ success: true, verified: true, order, payment });
    }

    const fastpay = getFastPayInstance();
    const sessionStatus = await fastpay.getPaymentStatus(sessionId);

    if (sessionStatus.status === 'COMPLETED' || sessionStatus.status === 'VERIFIED') {
      const actualTrxId = sessionStatus.transactionId || order.transactionId || '';
      const provider = sessionStatus.provider || 'FastPay';

      order.transactionId = actualTrxId;
      order.paymentProvider = provider;
      order.paymentMethod = 'FastPay';
      order.paymentStatus = 'verified';
      order.orderStatus = 'processing';
      order.deliveryStatus = 'pending';
      await order.save();

      const payment = await Payment.findOneAndUpdate(
        { order: order._id },
        {
          order: order._id,
          user: order.user,
          paymentMethod: 'FastPay',
          transactionId: actualTrxId,
          senderPhone: order.customerPhone || '',
          amount: order.totalAmount,
          status: 'verified',
          verifiedAt: new Date(),
        },
        { upsert: true, new: true }
      );

      const io = getIO();
      if (io) {
        const socketPayload = {
          paymentId: payment._id,
          orderId: order._id,
          orderNumber: order.orderNumber,
          status: 'verified',
          paymentStatus: 'verified',
          orderStatus: 'processing',
          deliveryStatus: 'pending',
          transactionId: actualTrxId,
        };
        io.to('admin_room').emit('payment-approved', socketPayload);
        io.to(`user_${order.user}`).emit('payment-approved', socketPayload);
        io.to(`user_${order.user}`).emit('order:updated', socketPayload);
      }

      return res.json({ success: true, verified: true, order, payment });
    }

    return res.json({ success: true, verified: false, status: sessionStatus.status, order });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || 'Session sync error' });
  }
});

// @route GET /api/fastpay/webhook-health (Health probe endpoint for Fast Pay webhook router)
router.get('/webhook-health', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    service: 'SubAccess BD',
    webhook: 'FastPay',
    status: 'alive',
    endpoint: '/api/fastpay/webhook',
  });
});

// @route POST /api/fastpay/webhook (Public server-to-server Fast Pay HMAC signed webhook endpoint)
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const signatureHeader = (req.headers['x-fastpay-signature'] || req.headers['x-signature']) as string | undefined;
    if (!signatureHeader) {
      return res.status(401).json({ success: false, message: 'Missing webhook signature header' });
    }

    const secret = process.env.FASTPAY_WEBHOOK_SECRET || '';
    if (!secret) {
      console.error('FASTPAY_WEBHOOK_SECRET is not configured on backend');
      return res.status(500).json({ success: false, message: 'Server webhook configuration error' });
    }

    // Verify HMAC signature using raw request body Buffer
    const rawBodyBuffer = (req as any).rawBody || req.body;
    const isValid = FastPay.verifyWebhookSignature(rawBodyBuffer, signatureHeader, secret);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid or expired webhook signature' });
    }

    // Safe JSON parse after HMAC verification succeeds
    let payload: any;
    try {
      if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
        payload = req.body;
      } else {
        const bodyStr = Buffer.isBuffer(rawBodyBuffer)
          ? rawBodyBuffer.toString('utf8')
          : typeof rawBodyBuffer === 'string'
          ? rawBodyBuffer
          : JSON.stringify(rawBodyBuffer);
        payload = JSON.parse(bodyStr);
      }
    } catch (_) {
      return res.status(400).json({ success: false, message: 'Invalid JSON payload format' });
    }

    const { event, data } = payload || {};

    // For unhandled / future webhook event types, acknowledge receipt safely
    if (event !== 'payment.verified') {
      return res.status(200).json({
        success: true,
        message: `Webhook event '${event || 'unknown'}' acknowledged without state changes`,
      });
    }

    const sessionId = data?.sessionId || data?.checkoutSessionId || data?.session_id || data?.id;
    const orderId = data?.orderId || data?.order_id;
    const transactionId =
      data?.transactionId ||
      data?.trxId ||
      data?.transaction_id ||
      data?.payment?.transactionId ||
      data?.payment?.trxId ||
      data?.payment?.transaction_id;
    const amount = Number(data?.amount || data?.payment?.amount);
    const provider = data?.provider || data?.gateway || data?.payment?.provider || data?.payment?.gateway || 'FastPay';

    // Locate SubAccess Order in MongoDB (Priority: fastpaySessionId -> orderId -> transactionId)
    let order: any = null;
    if (sessionId) {
      order = await Order.findOne({ fastpaySessionId: sessionId });
    }
    if (!order && orderId) {
      order = await Order.findById(orderId);
    }
    if (!order && transactionId) {
      order = await Order.findOne({ transactionId: String(transactionId).trim().toUpperCase() });
    }

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order associated with webhook session not found' });
    }

    // Idempotency check: if order is already verified, return HTTP 200 safely
    if (order.paymentStatus === 'verified') {
      return res.status(200).json({
        success: true,
        message: 'Webhook already processed (idempotent)',
        orderId: order._id,
      });
    }

    // Authoritative Amount Verification
    if (!isNaN(amount) && amount > 0 && Math.abs(amount - order.totalAmount) > 0.01) {
      console.error(`Fast Pay Webhook Security Alert: Amount mismatch for order ${order._id}. Expected: ${order.totalAmount}, Received: ${amount}`);
      return res.status(400).json({
        success: false,
        message: 'Verified payment amount does not match order total amount',
      });
    }

    // Check duplicate transaction ID across other verified orders
    const normalizedTrxId = transactionId ? String(transactionId).trim().toUpperCase() : '';
    if (normalizedTrxId) {
      const duplicateOrder = await Order.findOne({
        transactionId: normalizedTrxId,
        paymentStatus: 'verified',
        _id: { $ne: order._id },
      });
      if (duplicateOrder) {
        return res.status(400).json({
          success: false,
          message: 'Transaction ID is already associated with another verified order',
        });
      }
    }

    const finalTrxId = normalizedTrxId || order.transactionId || '';

    // Update Order state
    order.transactionId = finalTrxId;
    order.paymentProvider = provider || 'FastPay';
    order.paymentMethod = 'FastPay';
    order.paymentStatus = 'verified';
    order.orderStatus = 'processing';
    order.deliveryStatus = 'pending';
    await order.save();

    // Upsert Payment record
    const payment = await Payment.findOneAndUpdate(
      { order: order._id },
      {
        order: order._id,
        user: order.user,
        paymentMethod: 'FastPay',
        transactionId: finalTrxId,
        senderPhone: order.customerPhone || '',
        amount: order.totalAmount,
        status: 'verified',
        verifiedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    // Secondary async tasks: ActivityLog, Notification, Socket.IO
    (async () => {
      try {
        await ActivityLog.create({
          user: order.user,
          userName: order.customerName,
          action: 'Fast Pay Payment Verified',
          details: `Fast Pay webhook verified payment (TrxID ${finalTrxId}) for Order #${order.orderNumber} (৳${order.totalAmount})`,
        });

        await Notification.create({
          user: order.user,
          title: '🎉 Payment Completed!',
          message: `Payment completed successfully for order #${order.orderNumber}. Please wait while our admin prepares your subscription credentials.`,
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
            status: 'verified',
            paymentStatus: 'verified',
            orderStatus: 'processing',
            deliveryStatus: 'pending',
            transactionId: finalTrxId,
            pendingOrdersCount,
            pendingPaymentsCount,
          };

          io.to('admin_room').emit('payment-approved', socketPayload);
          io.to('admin_room').emit('dashboard-update', socketPayload);
          io.to(`user_${order.user}`).emit('payment-approved', socketPayload);
          io.to(`user_${order.user}`).emit('order:updated', {
            orderId: order._id,
            orderNumber: order.orderNumber,
            status: 'processing',
            paymentStatus: 'verified',
            deliveryStatus: 'pending',
            transactionId: finalTrxId,
          });
        }
      } catch (secErr) {
        console.error('Secondary error during Fast Pay webhook processing:', secErr);
      }
    })();

    return res.status(200).json({
      success: true,
      message: 'Fast Pay webhook processed successfully',
      orderId: order._id,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Fast Pay Webhook Error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error processing Fast Pay webhook',
    });
  }
});

export default router;

