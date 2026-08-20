import dotenv from "dotenv";
dotenv.config();

import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { connectDB } from './config/db.js';
import { initSocket } from './socket.js';
import { errorHandler } from './middleware/errorHandler.js';





import authRoutes from './routes/authRoutes.js';
import productRoutes from './routes/productRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import couponRoutes from './routes/couponRoutes.js';
import reviewRoutes from './routes/reviewRoutes.js';
import ticketRoutes from './routes/ticketRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import fastPayRoutes from './routes/fastpay.routes.js';

// Seed models
import { User } from './models/User.js';
import { Category } from './models/Category.js';
import { Product } from './models/Product.js';
import { Settings } from './models/Settings.js';
import { Coupon } from './models/Coupon.js';

const PORT = process.env.PORT || 5001;

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  const server = http.createServer(app);

  // Initialize Socket.IO
  initSocket(server);

  // Security and Middlewares
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5174',
    credentials: true,
  }));
  // Capture rawBody Buffer for HMAC webhook signature verification across all payload types
  app.use(
    express.json({
      limit: '10mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(
    express.urlencoded({
      extended: true,
      limit: '10mb',
      verify: (req: any, _res, buf) => {
        if (!req.rawBody) req.rawBody = buf;
      },
    })
  );
  app.use(
    express.text({
      type: ['text/*', 'application/jwt', 'application/octet-stream'],
      limit: '10mb',
      verify: (req: any, _res, buf) => {
        if (!req.rawBody) req.rawBody = buf;
      },
    })
  );

  // Rate Limiter
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { success: false, message: 'Too many requests, please try again later.' },
    validate: { xForwardedForHeader: false, default: false },
  });
  app.use('/api', apiLimiter);

  // Connect Database
  const dbConnected = await connectDB();

  // Seed default data if database is ready
  if (dbConnected) {
    try {
      await seedDatabase();
    } catch (err) {
      console.error('Seed error:', err);
    }
  }

  app.use('/api/fastpay', fastPayRoutes);

  // Register API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/coupons', couponRoutes);
  app.use('/api/reviews', reviewRoutes);
  app.use('/api/tickets', ticketRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/upload', uploadRoutes);

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'SubAccess BD API',
      timestamp: new Date(),
    });
  });

  // Global Express Error Handler
  app.use(errorHandler);

  server.listen(PORT, () => {
    console.log(`🚀 SubAccess BD Backend Server running on port ${PORT}`);
  });
}

async function seedDatabase() {
  // Settings seed
  const settingsCount = await Settings.countDocuments();
  if (settingsCount === 0) {
    await Settings.create({
      siteName: 'SubAccess BD',
      tagline: 'Professional Digital Subscription Marketplace in Bangladesh',
      bkashNumber: '01712345678',
      nagadNumber: '01812345678',
      rocketNumber: '01912345678',
      helplineEmail: 'support@subaccessbd.com',
      helplinePhone: '+8801712345678',
      noticeBannerText: '🎉 Flash Sale: Get 10% OFF on all Netflix & Canva Pro Subscriptions! Use Code: SUBBD10',
    });
  }

  // Admin User seed
  const adminEmail = (process.env.ADMIN_INITIAL_EMAIL || 'admin@subaccessbd.com').toLowerCase();
  const existingAdmin = await User.findOne({ email: adminEmail });
  if (!existingAdmin) {
    await User.create({
      name: 'SubAccess Admin',
      email: adminEmail,
      password: process.env.ADMIN_INITIAL_PASSWORD || 'AdminPassword123!',
      role: 'admin',
      isEmailVerified: true,
      phone: '01712345678',
    });
    console.log(`👤 Seeded Default Super Admin: ${adminEmail}`);
  }

  // Categories seed
  const catCount = await Category.countDocuments();
  if (catCount === 0) {
    await Category.create({
      name: 'Entertainment & Streaming',
      slug: 'entertainment',
      description: 'Netflix, Prime Video, Spotify Premium, YouTube Premium',
      icon: 'Tv',
      isFeatured: true,
    });

    await Category.create({
      name: 'Productivity & Design',
      slug: 'productivity-design',
      description: 'Canva Pro, Figma Pro, Adobe Creative Cloud, MS 365',
      icon: 'Palette',
      isFeatured: true,
    });

    await Category.create({
      name: 'AI & Developer Tools',
      slug: 'ai-developer-tools',
      description: 'ChatGPT Plus, JetBrains All Products, Claude Pro',
      icon: 'Cpu',
      isFeatured: true,
    });

    await Category.create({
      name: 'Education & Learning',
      slug: 'education-learning',
      description: 'Coursera Plus, LinkedIn Learning, Skillshare',
      icon: 'GraduationCap',
      isFeatured: true,
    });
  }

  // Coupon Seed
  const couponCount = await Coupon.countDocuments();
  if (couponCount === 0) {
    await Coupon.create({
      code: 'SUBBD10',
      discountPercentage: 10,
      maxDiscountBDT: 500,
      minSpendBDT: 200,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      isActive: true,
    });
  }
}

startServer();