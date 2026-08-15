import mongoose, { Schema, Document } from 'mongoose';

export interface IActivityLog extends Document {
  user?: mongoose.Types.ObjectId;
  userName?: string;
  action: string;
  ipAddress?: string;
  details?: string;
  createdAt: Date;
}

const ActivityLogSchema: Schema<IActivityLog> = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    userName: String,
    action: {
      type: String,
      required: true,
    },
    ipAddress: String,
    details: String,
  },
  {
    timestamps: true,
  }
);

export const ActivityLog = mongoose.model<IActivityLog>('ActivityLog', ActivityLogSchema);
