import mongoose, { Schema, Document } from 'mongoose';

export interface ISettings extends Document {
  siteName: string;
  tagline: string;
  bkashNumber: string;
  nagadNumber: string;
  rocketNumber: string;
  helplineEmail: string;
  helplinePhone: string;
  whatsappNumber: string;
  noticeBannerText: string;
  noticeActive: boolean;
  maintenanceMode: boolean;
  updatedAt: Date;
}

const SettingsSchema: Schema<ISettings> = new Schema(
  {
    siteName: { type: String, default: 'SubAccess BD' },
    tagline: { type: String, default: 'Digital Subscription Marketplace in Bangladesh' },
    bkashNumber: { type: String, default: '01700000000' },
    nagadNumber: { type: String, default: '01800000000' },
    rocketNumber: { type: String, default: '01900000000' },
    helplineEmail: { type: String, default: 'support@subaccessbd.com' },
    helplinePhone: { type: String, default: '+8801700000000' },
    whatsappNumber: { type: String, default: '+8801700000000' },
    noticeBannerText: { type: String, default: '🎉 Get 10% OFF on all Netflix & Canva Pro Subscriptions! Use Code: SUBBD10' },
    noticeActive: { type: Boolean, default: true },
    maintenanceMode: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

export const Settings = mongoose.model<ISettings>('Settings', SettingsSchema);
