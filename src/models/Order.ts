import mongoose, { Schema, Document } from 'mongoose';

export interface IDeliveredCredential {
  label: string;
  value: string;
}

export interface IOrderItem {
  product: mongoose.Types.ObjectId;
  title: string;
  image?: string;
  category?: string;
  price: number;
  discount?: number;
  quantity: number;
  duration: string;
  accessType: string;
  finalAmount?: number;
}

export interface IOrder extends Document {
  orderNumber: string;
  user: mongoose.Types.ObjectId;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: IOrderItem[];
  totalAmount: number;
  discountAmount: number;
  couponCode?: string;
  paymentMethod: 'bKash' | 'Nagad' | 'Rocket' | 'FastPay';
  transactionId?: string;
  senderPhone?: string;
  paymentScreenshot?: string;
  paymentStatus: 'pending' | 'verified' | 'rejected' | 'refunded';
  orderStatus: 'pending' | 'processing' | 'completed' | 'cancelled';
  deliveryStatus: 'pending' | 'processing' | 'delivered' | 'cancelled';
  fastpaySessionId?: string;
  paymentProvider?: string;
  deliveredCredentials: IDeliveredCredential[];
  deliveryInstructions?: string;
  adminNotes?: string;
  rejectionReason?: string;
  verifiedBy?: mongoose.Types.ObjectId;
  assignedTo?: mongoose.Types.ObjectId;
  completedAt?: Date;
  timeline?: {
    status: string;
    note: string;
    updatedBy?: string;
    timestamp: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const OrderSchema: Schema<IOrder> = new Schema(
  {
    orderNumber: {
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
    },
    customerEmail: {
      type: String,
      required: true,
    },
    customerPhone: {
      type: String,
      required: true,
    },
    items: [
      {
        product: {
          type: Schema.Types.ObjectId,
          ref: 'Product',
          required: true,
        },
        title: { type: String, required: true },
        image: { type: String, default: '' },
        category: { type: String, default: '' },
        price: { type: Number, required: true },
        discount: { type: Number, default: 0 },
        quantity: { type: Number, default: 1 },
        duration: { type: String, default: '1 Month' },
        accessType: { type: String, default: 'Shared' },
        finalAmount: { type: Number, default: 0 },
      },
    ],
    totalAmount: {
      type: Number,
      required: true,
    },
    discountAmount: {
      type: Number,
      default: 0,
    },
    couponCode: {
      type: String,
      default: '',
    },
    paymentMethod: {
      type: String,
      enum: ['bKash', 'Nagad', 'Rocket', 'FastPay'],
      required: true,
      default: 'FastPay',
    },
    transactionId: {
      type: String,
      required: false,
      default: '',
      trim: true,
    },
    senderPhone: {
      type: String,
      required: false,
      default: '',
      trim: true,
    },
    paymentScreenshot: {
      type: String,
      default: '',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected', 'refunded'],
      default: 'pending',
    },
    orderStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'cancelled'],
      default: 'pending',
    },
    deliveryStatus: {
      type: String,
      enum: ['pending', 'processing', 'delivered', 'cancelled'],
      default: 'pending',
    },
    fastpaySessionId: {
      type: String,
      default: '',
      trim: true,
    },
    paymentProvider: {
      type: String,
      default: '',
      trim: true,
    },
    deliveredCredentials: [
      {
        label: String,
        value: String,
      },
    ],
    deliveryInstructions: {
      type: String,
      default: '',
    },
    adminNotes: {
      type: String,
      default: '',
    },
    rejectionReason: {
      type: String,
      default: '',
    },
    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    completedAt: Date,
    timeline: [
      {
        status: String,
        note: String,
        updatedBy: String,
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

OrderSchema.index({ user: 1 });
OrderSchema.index({ orderStatus: 1 });
OrderSchema.index({ paymentStatus: 1 });
OrderSchema.index({ transactionId: 1 });
OrderSchema.index({ fastpaySessionId: 1 });
OrderSchema.index({ createdAt: -1 });

export const Order = mongoose.model<IOrder>('Order', OrderSchema);