import { Router, Response } from 'express';
import { Notification } from '../models/Notification.js';
import { protect, AuthRequest } from '../middleware/auth.js';

const router = Router();

// @route GET /api/notifications
router.get('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(30);
    const unreadCount = await Notification.countDocuments({ user: req.user._id, isRead: false });

    res.json({ success: true, notifications, unreadCount });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PUT /api/notifications/read-all
router.put('/read-all', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
