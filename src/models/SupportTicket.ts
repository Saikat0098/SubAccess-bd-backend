import mongoose, { Schema, Document } from 'mongoose';

export interface ITicketMessage {
  _id?: mongoose.Types.ObjectId | string;
  sender: mongoose.Types.ObjectId | string;
  senderName: string;
  senderEmail?: string;
  senderRole: 'user' | 'admin';
  message: string;
  text?: string;
  attachments?: string[];
  timestamp: Date;
  createdAt?: Date;
  isRead?: boolean;
}

export interface ISupportTicket extends Document {
  ticketId: string;
  user: mongoose.Types.ObjectId;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  subject: string;
  category: string;
  orderNumber?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  description: string;
  attachments?: string[];
  status: 'open' | 'waiting_customer' | 'waiting_admin' | 'in_progress' | 'resolved' | 'closed' | 'reopened';
  assignedStaff?: string;
  internalNotes?: string;
  messages: ITicketMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const SupportTicketSchema: Schema<ISupportTicket> = new Schema(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    customerEmail: {
      type: String,
      required: true,
      trim: true,
    },
    customerPhone: {
      type: String,
      default: '',
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      default: 'General Support',
    },
    orderNumber: {
      type: String,
      default: '',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    attachments: [
      {
        type: String,
      },
    ],
    status: {
      type: String,
      enum: ['open', 'waiting_customer', 'waiting_admin', 'in_progress', 'resolved', 'closed', 'reopened'],
      default: 'open',
    },
    assignedStaff: {
      type: String,
      default: 'Unassigned',
    },
    internalNotes: {
      type: String,
      default: '',
    },
    messages: [
      {
        sender: { type: Schema.Types.ObjectId, ref: 'User' },
        senderName: { type: String, required: true },
        senderEmail: { type: String, default: '' },
        senderRole: { type: String, enum: ['user', 'admin'], default: 'user' },
        message: { type: String, required: true },
        text: { type: String, default: '' },
        attachments: [{ type: String }],
        timestamp: { type: Date, default: Date.now },
        createdAt: { type: Date, default: Date.now },
        isRead: { type: Boolean, default: false },
      },
    ],
  },
  {
    timestamps: true,
  }
);

export const SupportTicket = mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema);
