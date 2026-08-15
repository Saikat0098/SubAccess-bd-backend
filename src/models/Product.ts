import mongoose, { Schema, Document } from 'mongoose';

export interface IProduct extends Document {
  title: string;
  slug: string;
  category: mongoose.Types.ObjectId;
  price: number;
  discountPrice?: number;
  duration: string; // e.g. "Monthly Shared", "Monthly Private", "Yearly", "1 Month", "Lifetime"
  accessType: 'credentials' | 'invite_link' | 'license_key' | 'download_link';
  description: string;
  features: string[];
  stockQuantity: number;
  image: string;
  bannerColor?: string;
  deliveryTimeText: string; // e.g. "Instant Delivery (1-10 Mins)"
  isActive: boolean;
  isPopular?: boolean;
  averageRating: number;
  totalReviews: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema: Schema<IProduct> = new Schema(
  {
    title: {
      type: String,
      required: [true, 'Product title is required'],
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: 0,
    },
    discountPrice: {
      type: Number,
      default: 0,
    },
    duration: {
      type: String,
      required: true,
      default: '1 Month',
    },
    accessType: {
      type: String,
      enum: ['credentials', 'invite_link', 'license_key', 'download_link'],
      default: 'credentials',
    },
    description: {
      type: String,
      required: true,
    },
    features: {
      type: [String],
      default: [],
    },
    stockQuantity: {
      type: Number,
      default: 100,
    },
    image: {
      type: String,
      default: '',
    },
    bannerColor: {
      type: String,
      default: 'from-blue-600 to-indigo-600',
    },
    deliveryTimeText: {
      type: String,
      default: 'Instant / 1-15 Mins',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isPopular: {
      type: Boolean,
      default: false,
    },
    averageRating: {
      type: Number,
      default: 5.0,
      min: 1,
      max: 5,
    },
    totalReviews: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

export const Product = mongoose.model<IProduct>('Product', ProductSchema);
