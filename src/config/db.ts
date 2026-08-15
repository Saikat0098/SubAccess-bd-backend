import mongoose from 'mongoose';

export const connectDB = async (): Promise<boolean> => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri || mongoUri.includes('<MY_MONGODB_ATLAS_URI>')) {
    console.error('\n================================================================');
    console.error('❌ FATAL DATABASE ERROR: MONGODB_URI is missing or not configured!');
    console.error('SubAccess BD is a production app and requires a valid MongoDB Atlas connection.');
    console.error('Please set process.env.MONGODB_URI in your environment variables.');
    console.error('================================================================\n');
    process.exit(1);
  }

  try {
    mongoose.set('strictQuery', false);

    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log(`✅ MongoDB Atlas Connected Successfully: ${conn.connection.host}`);
    return true;
  } catch (error: any) {
    console.error('\n================================================================');
    console.error(`❌ FATAL DATABASE CONNECTION ERROR: ${error.message}`);
    console.error('Failed to connect to MongoDB Atlas via process.env.MONGODB_URI.');
    console.error('Server execution stopped.');
    console.error('================================================================\n');
    process.exit(1);
  }
};