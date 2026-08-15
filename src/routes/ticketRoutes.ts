import { Router, Response } from 'express';
import { SupportTicket } from '../models/SupportTicket.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { protect, isAdmin, AuthRequest } from '../middleware/auth.js';
import { getIO } from '../socket.js';

const router = Router();

// @route POST /api/tickets (Create Ticket)
router.post('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const { subject, category, orderNumber, priority, description, attachments } = req.body;
    const initialMessage = description || req.body.message;

    if (!subject || !initialMessage) {
      return res.status(400).json({ success: false, message: 'Subject and issue description are required' });
    }

    const ticketId = 'TICK-' + Math.floor(100000 + Math.random() * 900000);
    const now = new Date();

    const formattedAttachments = Array.isArray(attachments) ? attachments : attachments ? [attachments] : [];

    // First chat message is created automatically from the user's issue description
    const firstMessage = {
      sender: req.user._id,
      senderName: req.user.name,
      senderEmail: req.user.email,
      senderRole: req.user.role as 'user' | 'admin',
      message: initialMessage.trim(),
      text: initialMessage.trim(),
      attachments: formattedAttachments,
      timestamp: now,
      createdAt: now,
      isRead: true,
    };

    const ticket = await SupportTicket.create({
      ticketId,
      user: req.user._id,
      customerName: req.user.name,
      customerEmail: req.user.email,
      customerPhone: req.user.phone || '',
      subject: subject.trim(),
      category: category || 'General Support',
      orderNumber: orderNumber || '',
      priority: priority || 'medium',
      description: initialMessage.trim(),
      attachments: formattedAttachments,
      status: 'open',
      assignedStaff: 'Unassigned',
      messages: [firstMessage],
    });

    // Execute Secondary Non-Critical Tasks (Admin Notifications & Sockets) Safely
    (async () => {
      try {
        const admins = await User.find({ role: 'admin' }).select('_id');
        for (const admin of admins) {
          await Notification.create({
            user: admin._id,
            title: '📩 New Support Ticket',
            message: `Ticket #${ticket.ticketId} created by ${req.user?.name}: "${subject}"`,
            type: 'ticket',
            link: '/admin/support',
          });
        }

        const io = getIO();
        if (io) {
          const pendingTicketsCount = await SupportTicket.countDocuments({
            status: { $in: ['open', 'waiting_admin'] },
          });

          io.to('admin_room').emit('new-ticket', {
            ticket,
            ticketId: ticket.ticketId,
            subject: ticket.subject,
            customerName: req.user?.name,
            pendingTicketsCount,
          });

          io.to('admin_room').emit('badge-update', {
            pendingTicketsCount,
          });

          io.to('admin_room').emit('ticket:created', {
            ticket,
            ticketId: ticket.ticketId,
            subject: ticket.subject,
            customerName: req.user?.name,
            pendingTicketsCount,
          });

          io.to('admin_room').emit('ticket:message', {
            ticketId: ticket.ticketId,
            ticketDbId: ticket._id,
            message: firstMessage,
          });
        }
      } catch (secondaryErr) {
        console.error('Non-critical secondary task error on ticket creation:', secondaryErr);
      }
    })();

    res.status(201).json({ success: true, ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route GET /api/tickets/my-tickets (User's tickets)
router.get('/my-tickets', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const tickets = await SupportTicket.find({ user: req.user._id }).sort({ updatedAt: -1 });
    res.json({ success: true, tickets });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route GET /api/tickets/all (Admin - List all tickets with search and filters)
router.get('/all', protect, isAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { status, priority, category, search } = req.query;
    let filter: any = {};

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      filter.$or = [
        { ticketId: { $regex: q, $options: 'i' } },
        { subject: { $regex: q, $options: 'i' } },
        { customerName: { $regex: q, $options: 'i' } },
        { customerEmail: { $regex: q, $options: 'i' } },
        { orderNumber: { $regex: q, $options: 'i' } },
      ];
    }

    const tickets = await SupportTicket.find(filter)
      .populate('user', 'name email phone avatar')
      .sort({ updatedAt: -1 });

    res.json({ success: true, tickets });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route GET /api/tickets/:id (Get single ticket details)
router.get('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const ticket = await SupportTicket.findById(req.params.id).populate('user', 'name email phone avatar');
    if (!ticket) return res.status(404).json({ success: false, message: 'Support ticket not found' });

    if (req.user.role !== 'admin' && ticket.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    res.json({ success: true, ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route POST /api/tickets/:id/reply (Reply in Ticket Chat)
router.post('/:id/reply', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const { message, attachments } = req.body;
    const messageContent = message || req.body.text;

    if (!messageContent || !messageContent.trim()) {
      return res.status(400).json({ success: false, message: 'Message content is required' });
    }

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Support ticket not found' });

    const now = new Date();
    const formattedAttachments = Array.isArray(attachments) ? attachments : attachments ? [attachments] : [];

    const newMsg = {
      sender: req.user._id,
      senderName: req.user.name,
      senderEmail: req.user.email,
      senderRole: req.user.role as 'user' | 'admin',
      message: messageContent.trim(),
      text: messageContent.trim(),
      attachments: formattedAttachments,
      timestamp: now,
      createdAt: now,
      isRead: false,
    };

    ticket.messages.push(newMsg);

    if (req.user.role === 'admin') {
      ticket.status = 'waiting_customer';
    } else {
      ticket.status = 'waiting_admin';
    }

    await ticket.save();

    // Execute Secondary Non-Critical Background Tasks (Notifications & Sockets) Safely
    (async () => {
      try {
        if (req.user?.role === 'admin') {
          await Notification.create({
            user: ticket.user,
            title: `💬 Reply on Ticket #${ticket.ticketId}`,
            message: `Admin replied: "${messageContent.trim().slice(0, 60)}..."`,
            type: 'ticket',
            link: '/user/support',
          });
        } else {
          const admins = await User.find({ role: 'admin' }).select('_id');
          for (const admin of admins) {
            await Notification.create({
              user: admin._id,
              title: `💬 Customer Reply on Ticket #${ticket.ticketId}`,
              message: `${req.user?.name} replied: "${messageContent.trim().slice(0, 60)}..."`,
              type: 'ticket',
              link: '/admin/support',
            });
          }
        }

        const io = getIO();
        if (io) {
          const payload = {
            ticketId: ticket.ticketId,
            ticketDbId: ticket._id,
            status: ticket.status,
            message: newMsg,
          };

          io.to(`ticket_${ticket._id}`).emit('ticket:message', payload);
          io.to(`ticket_${ticket.ticketId}`).emit('ticket:message', payload);

          if (req.user?.role === 'admin') {
            io.to(`user_${ticket.user}`).emit('ticket:message', payload);
            io.to(`user_${ticket.user}`).emit('notification:new', {
              title: 'Ticket Reply',
              message: `Admin replied to #${ticket.ticketId}`,
            });
          } else {
            io.to('admin_room').emit('ticket:message', payload);
          }
        }
      } catch (secondaryErr) {
        console.error('Non-critical secondary task error on ticket reply:', secondaryErr);
      }
    })();

    res.json({ success: true, ticket, newMsg });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PATCH /api/tickets/:id/status (Change Status)
router.patch('/:id/status', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const { status } = req.body;
    const validStatuses = ['open', 'waiting_customer', 'waiting_admin', 'in_progress', 'resolved', 'closed', 'reopened'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Support ticket not found' });

    if (req.user.role !== 'admin' && ticket.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to modify this ticket' });
    }

    ticket.status = status;
    await ticket.save();

    const io = getIO();
    if (io) {
      const pendingTicketsCount = await SupportTicket.countDocuments({
        status: { $in: ['open', 'waiting_admin'] },
      });

      const payload = { ticketId: ticket.ticketId, ticketDbId: ticket._id, status, pendingTicketsCount };
      io.to(`ticket_${ticket._id}`).emit('ticket:status_change', payload);
      io.to(`user_${ticket.user}`).emit('ticket:status_change', payload);
      io.to('admin_room').emit('ticket:status_change', payload);
      io.to('admin_room').emit('badge-update', { pendingTicketsCount });
    }

    res.json({ success: true, message: `Ticket status updated to ${status}`, ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PATCH /api/tickets/:id/priority (Admin - Change Priority)
router.patch('/:id/priority', protect, isAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { priority } = req.body;
    if (!['low', 'medium', 'high', 'urgent'].includes(priority)) {
      return res.status(400).json({ success: false, message: 'Invalid priority' });
    }

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Support ticket not found' });

    ticket.priority = priority;
    await ticket.save();

    res.json({ success: true, message: `Priority updated to ${priority}`, ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PATCH /api/tickets/:id/assign (Admin - Assign Staff)
router.patch('/:id/assign', protect, isAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { staffName } = req.body;
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Support ticket not found' });

    ticket.assignedStaff = staffName || 'Unassigned';
    await ticket.save();

    res.json({ success: true, message: 'Assigned staff updated', ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PATCH /api/tickets/:id/notes (Admin - Internal Notes)
router.patch('/:id/notes', protect, isAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { internalNotes } = req.body;
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Support ticket not found' });

    ticket.internalNotes = internalNotes || '';
    await ticket.save();

    res.json({ success: true, message: 'Internal notes saved', ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
