import mongoose, { Schema, Document } from 'mongoose';

export interface ICoupon extends Document {
  code: string;
  discountPercentage: number;
  discountType?: 'percent' | 'fixed';
  discountValue?: number;
  minOrderAmount?: number;
  maxDiscountBDT?: number;
  minSpendBDT?: number;
  expiresAt: Date;
  usageLimit?: number;
  usageCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CouponSchema: Schema<ICoupon> = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    discountPercentage: {
      type: Number,
      default: 0,
    },
    discountType: {
      type: String,
      enum: ['percent', 'fixed'],
      default: 'percent',
    },
    discountValue: {
      type: Number,
      default: 0,
    },
    minOrderAmount: {
      type: Number,
      default: 0,
    },
    maxDiscountBDT: {
      type: Number,
      default: 5000,
    },
    minSpendBDT: {
      type: Number,
      default: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usageLimit: {
      type: Number,
      default: 1000,
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Coupon = mongoose.model<ICoupon>('Coupon', CouponSchema);
