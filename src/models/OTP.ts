import mongoose, { Schema, Document } from 'mongoose';

export interface IOTP extends Document {
  email: string;
  otpCode: string;
  expiresAt: Date;
  createdAt: Date;
}

const OTPSchema: Schema<IOTP> = new Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    otpCode: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      expires: 300, // Automatic deletion after 5 minutes
    },
  },
  {
    timestamps: true,
  }
);

export const OTP = mongoose.model<IOTP>('OTP', OTPSchema);
