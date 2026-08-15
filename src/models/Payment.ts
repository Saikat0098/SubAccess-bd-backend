import mongoose, { Schema, Document } from 'mongoose';

export interface IPayment extends Document {
  order: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  paymentMethod: 'bKash' | 'Nagad' | 'Rocket' | 'FastPay';
  transactionId?: string;
  senderPhone?: string;
  amount: number;
  paymentScreenshot?: string;
  status: 'pending' | 'verified' | 'rejected' | 'refunded';
  rejectionReason?: string;
  adminNotes?: string;
  verifiedBy?: mongoose.Types.ObjectId;
  verifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema: Schema<IPayment> = new Schema(
  {
    order: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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
    amount: {
      type: Number,
      required: true,
    },
    paymentScreenshot: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'verified', 'rejected', 'refunded'],
      default: 'pending',
    },
    rejectionReason: {
      type: String,
      default: '',
    },
    adminNotes: {
      type: String,
      default: '',
    },
    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    verifiedAt: Date,
  },
  {
    timestamps: true,
  }
);

PaymentSchema.index({ order: 1 });
PaymentSchema.index({ user: 1 });
PaymentSchema.index({ status: 1 });
PaymentSchema.index({ transactionId: 1 });
PaymentSchema.index({ createdAt: -1 });

export const Payment = mongoose.model<IPayment>('Payment', PaymentSchema);
