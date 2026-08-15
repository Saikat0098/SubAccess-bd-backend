// src/server.ts
import dotenv from "dotenv";
import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

// src/config/db.ts
import mongoose from "mongoose";
var connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri || mongoUri.includes("<MY_MONGODB_ATLAS_URI>")) {
    console.error("\n================================================================");
    console.error("\u274C FATAL DATABASE ERROR: MONGODB_URI is missing or not configured!");
    console.error("SubAccess BD is a production app and requires a valid MongoDB Atlas connection.");
    console.error("Please set process.env.MONGODB_URI in your environment variables.");
    console.error("================================================================\n");
    process.exit(1);
  }
  try {
    mongoose.set("strictQuery", false);
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5e3
    });
    console.log(`\u2705 MongoDB Atlas Connected Successfully: ${conn.connection.host}`);
    return true;
  } catch (error) {
    console.error("\n================================================================");
    console.error(`\u274C FATAL DATABASE CONNECTION ERROR: ${error.message}`);
    console.error("Failed to connect to MongoDB Atlas via process.env.MONGODB_URI.");
    console.error("Server execution stopped.");
    console.error("================================================================\n");
    process.exit(1);
  }
};

// src/socket.ts
import { Server } from "socket.io";
var io = null;
var initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  io.on("connection", (socket) => {
    console.log(`\u26A1 Socket connected: ${socket.id}`);
    socket.on("join_user", (userId) => {
      if (userId) {
        socket.join(`user_${userId}`);
        console.log(`Socket ${socket.id} joined room user_${userId}`);
      }
    });
    socket.on("join_admin", () => {
      socket.join("admin_room");
      console.log(`Socket ${socket.id} joined admin_room`);
    });
    socket.on("join_ticket", (ticketId) => {
      if (ticketId) {
        socket.join(`ticket_${ticketId}`);
        console.log(`Socket ${socket.id} joined room ticket_${ticketId}`);
      }
    });
    socket.on("leave_ticket", (ticketId) => {
      if (ticketId) {
        socket.leave(`ticket_${ticketId}`);
        console.log(`Socket ${socket.id} left room ticket_${ticketId}`);
      }
    });
    socket.on("disconnect", () => {
      console.log(`\u{1F50C} Socket disconnected: ${socket.id}`);
    });
  });
  return io;
};
var getIO = () => {
  if (!io) {
    throw new Error("Socket.IO not initialized");
  }
  return io;
};

// src/middleware/errorHandler.ts
var errorHandler = (err, req, res, next) => {
  console.error("API Error:", err);
  if (res.headersSent) {
    return next(err);
  }
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "Internal Server Error";
  res.status(statusCode).json({
    success: false,
    message,
    error: message,
    stack: process.env.NODE_ENV === "production" ? null : err.stack
  });
};

// src/routes/authRoutes.ts
import { Router } from "express";
import jwt2 from "jsonwebtoken";

// src/models/User.ts
import mongoose2, { Schema } from "mongoose";
import bcrypt from "bcryptjs";
var UserSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      minlength: 6,
      select: false
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user"
    },
    isEmailVerified: {
      type: Boolean,
      default: false
    },
    phone: {
      type: String,
      default: ""
    },
    avatar: {
      type: String,
      default: ""
    },
    address: {
      type: String,
      default: ""
    },
    isBlocked: {
      type: Boolean,
      default: false
    },
    googleId: {
      type: String,
      default: ""
    },
    refreshToken: {
      type: String,
      select: false
    },
    resetPasswordToken: String,
    resetPasswordExpires: Date
  },
  {
    timestamps: true
  }
);
UserSchema.pre("save", async function() {
  if (!this.isModified("password") || !this.password) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});
UserSchema.methods.matchPassword = async function(enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};
var User = mongoose2.model("User", UserSchema);

// src/models/OTP.ts
import mongoose3, { Schema as Schema2 } from "mongoose";
var OTPSchema = new Schema2(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    otpCode: {
      type: String,
      required: true
    },
    expiresAt: {
      type: Date,
      required: true,
      expires: 300
      // Automatic deletion after 5 minutes
    }
  },
  {
    timestamps: true
  }
);
var OTP = mongoose3.model("OTP", OTPSchema);

// src/models/ActivityLog.ts
import mongoose4, { Schema as Schema3 } from "mongoose";
var ActivityLogSchema = new Schema3(
  {
    user: {
      type: Schema3.Types.ObjectId,
      ref: "User"
    },
    userName: String,
    action: {
      type: String,
      required: true
    },
    ipAddress: String,
    details: String
  },
  {
    timestamps: true
  }
);
var ActivityLog = mongoose4.model("ActivityLog", ActivityLogSchema);

// src/utils/email.ts
import nodemailer from "nodemailer";
var sendOTPEmail = async (toEmail, otpCode) => {
  try {
    const host = process.env.EMAIL_HOST || "smtp.gmail.com";
    const port = Number(process.env.EMAIL_PORT) || 587;
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;
    if (!user || !pass || user.includes("support@subaccessbd.com")) {
      console.log(`[EMAIL DEV LOG] OTP for ${toEmail}: ${otpCode}`);
      return true;
    }
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
        <div style="background-color: #0284c7; padding: 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 24px; font-weight: bold;">SubAccess BD</h1>
          <p style="margin: 4px 0 0 0; opacity: 0.9;">Digital Subscription Marketplace</p>
        </div>
        <div style="padding: 32px; color: #334155;">
          <h2 style="margin-top: 0; font-size: 20px; color: #0f172a;">Verify Your Email Address</h2>
          <p style="font-size: 15px; line-height: 1.6;">Thank you for registering on SubAccess BD. Please use the following 6-digit OTP code to verify your account:</p>
          <div style="margin: 28px 0; text-align: center;">
            <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0284c7; background-color: #f0f9ff; padding: 12px 28px; border-radius: 8px; border: 1px dashed #0284c7;">${otpCode}</span>
          </div>
          <p style="font-size: 14px; color: #64748b; margin-bottom: 0;">This OTP code is valid for <strong>5 minutes</strong>. Do not share this code with anyone.</p>
        </div>
        <div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 13px; color: #94a3b8; border-top: 1px solid #f1f5f9;">
          &copy; ${(/* @__PURE__ */ new Date()).getFullYear()} SubAccess BD. All rights reserved.
        </div>
      </div>
    `;
    await transporter.sendMail({
      from: `"SubAccess BD Support" <${user}>`,
      to: toEmail,
      subject: `[SubAccess BD] ${otpCode} is your verification code`,
      html: htmlContent
    });
    return true;
  } catch (error) {
    console.error("Nodemailer send error:", error);
    return true;
  }
};

// src/middleware/auth.ts
import jwt from "jsonwebtoken";
var protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (!token) {
    return res.status(401).json({ success: false, message: "Not authorized, no token provided" });
  }
  try {
    const secret = process.env.JWT_SECRET || "subaccess_jwt_secret_key_2026_production";
    const decoded = jwt.verify(token, secret);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: "User account not found" });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Not authorized, token expired or invalid" });
  }
};
var isAdmin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    return res.status(403).json({ success: false, message: "Access denied: Admin role required" });
  }
};

// src/routes/authRoutes.ts
var router = Router();
var generateTokens = (userId) => {
  const jwtSecret = process.env.JWT_SECRET || "subaccess_jwt_secret_key_2026_production";
  const refreshSecret = process.env.JWT_REFRESH_SECRET || "subaccess_refresh_secret_key_2026_production";
  const accessToken = jwt2.sign({ id: userId }, jwtSecret, { expiresIn: "7d" });
  const refreshToken = jwt2.sign({ id: userId }, refreshSecret, { expiresIn: "30d" });
  return { accessToken, refreshToken };
};
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email and password are required." });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email already registered." });
    }
    const count = await User.countDocuments();
    const role = count === 0 ? "admin" : "user";
    const hasRealSmtp = Boolean(
      process.env.EMAIL_USER && process.env.EMAIL_PASS && !process.env.EMAIL_USER.includes("support@subaccessbd.com") && process.env.REQUIRE_EMAIL_VERIFICATION === "true"
    );
    if (hasRealSmtp) {
      const user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        password,
        phone: phone ? phone.trim() : "",
        role,
        isEmailVerified: false
      });
      const otpCode = Math.floor(1e5 + Math.random() * 9e5).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1e3);
      await OTP.deleteMany({ email: user.email });
      await OTP.create({ email: user.email, otpCode, expiresAt });
      await sendOTPEmail(user.email, otpCode);
      return res.status(201).json({
        success: true,
        requiresVerification: true,
        message: "Registration successful! Verification code sent to your email.",
        email: user.email
      });
    } else {
      const user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        password,
        phone: phone ? phone.trim() : "",
        role,
        isEmailVerified: true
      });
      const tokens = generateTokens(user._id.toString());
      user.refreshToken = tokens.refreshToken;
      await user.save();
      await ActivityLog.create({
        user: user._id,
        userName: user.name,
        action: "Account Registration",
        ipAddress: req.ip,
        details: `Registered account via Email (${user.email})`
      });
      return res.status(201).json({
        success: true,
        requiresVerification: false,
        message: "Account created successfully!",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
          phone: user.phone,
          avatar: user.avatar
        },
        tokens
      });
    }
  } catch (error) {
    if (error.code === 11e3) {
      return res.status(400).json({ success: false, message: "Email already registered." });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otpCode } = req.body;
    if (!email || !otpCode) {
      return res.status(400).json({ success: false, message: "Email and verification code are required" });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const otpRecord = await OTP.findOne({ email: normalizedEmail, otpCode: otpCode.trim() });
    if (!otpRecord) {
      return res.status(400).json({ success: false, message: "Invalid or expired verification code" });
    }
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    user.isEmailVerified = true;
    await user.save();
    await OTP.deleteMany({ email: user.email });
    const tokens = generateTokens(user._id.toString());
    user.refreshToken = tokens.refreshToken;
    await user.save();
    res.json({
      success: true,
      message: "Email verified successfully!",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        phone: user.phone,
        avatar: user.avatar
      },
      tokens
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router.post("/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });
    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    const otpCode = Math.floor(1e5 + Math.random() * 9e5).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1e3);
    await OTP.deleteMany({ email: user.email });
    await OTP.create({ email: user.email, otpCode, expiresAt });
    await sendOTPEmail(user.email, otpCode);
    res.json({
      success: true,
      message: "A new 6-digit verification code has been sent to your email."
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).select("+password");
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }
    const tokens = generateTokens(user._id.toString());
    user.refreshToken = tokens.refreshToken;
    await user.save();
    await ActivityLog.create({
      user: user._id,
      userName: user.name,
      action: "User Login",
      ipAddress: req.ip,
      details: `Logged in via Email (${user.email})`
    });
    res.json({
      success: true,
      message: "Login successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        phone: user.phone,
        avatar: user.avatar
      },
      tokens
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router.post("/refresh-token", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: "Refresh token is required" });
    }
    const refreshSecret = process.env.JWT_REFRESH_SECRET || "subaccess_refresh_secret_key_2026_production";
    const decoded = jwt2.verify(refreshToken, refreshSecret);
    const user = await User.findById(decoded.id).select("+refreshToken");
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ success: false, message: "Invalid or revoked refresh token" });
    }
    const tokens = generateTokens(user._id.toString());
    user.refreshToken = tokens.refreshToken;
    await user.save();
    res.json({
      success: true,
      tokens
    });
  } catch (error) {
    res.status(401).json({ success: false, message: "Expired or invalid refresh token" });
  }
});
router.post("/google", async (req, res) => {
  try {
    const { name, email, googleId, avatar } = req.body;
    if (!email || !googleId) {
      return res.status(400).json({ success: false, message: "Google authentication data incomplete" });
    }
    const normalizedEmail = email.trim().toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      const count = await User.countDocuments();
      const role = count === 0 ? "admin" : "user";
      user = await User.create({
        name: name || "Google User",
        email: normalizedEmail,
        googleId,
        avatar: avatar || "",
        role,
        isEmailVerified: true
      });
    } else {
      user.googleId = googleId;
      if (avatar) user.avatar = avatar;
      user.isEmailVerified = true;
      await user.save();
    }
    const tokens = generateTokens(user._id.toString());
    user.refreshToken = tokens.refreshToken;
    await user.save();
    res.json({
      success: true,
      message: "Google login successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        phone: user.phone,
        avatar: user.avatar
      },
      tokens
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router.get("/me", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    res.json({
      success: true,
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        isEmailVerified: req.user.isEmailVerified,
        phone: req.user.phone,
        avatar: req.user.avatar,
        address: req.user.address || "",
        createdAt: req.user.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router.put("/profile", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const { name, phone, avatar, address } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (name) user.name = name;
    if (phone !== void 0) user.phone = phone;
    if (avatar !== void 0) user.avatar = avatar;
    if (address !== void 0) user.address = address;
    await user.save();
    await ActivityLog.create({
      user: user._id,
      userName: user.name,
      action: "Profile Updated",
      details: "User updated profile information"
    });
    res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        phone: user.phone,
        avatar: user.avatar,
        address: user.address || ""
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router.post("/change-password", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new password are required" });
    }
    const user = await User.findById(req.user._id).select("+password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.password) {
      const isMatch = await user.matchPassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: "Incorrect current password" });
      }
    }
    user.password = newPassword;
    await user.save();
    await ActivityLog.create({
      user: user._id,
      userName: user.name,
      action: "Password Changed",
      details: "User changed account password"
    });
    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
var authRoutes_default = router;

// src/routes/productRoutes.ts
import { Router as Router2 } from "express";

// src/models/Product.ts
import mongoose5, { Schema as Schema4 } from "mongoose";
var ProductSchema = new Schema4(
  {
    title: {
      type: String,
      required: [true, "Product title is required"],
      trim: true
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    category: {
      type: Schema4.Types.ObjectId,
      ref: "Category",
      required: true
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: 0
    },
    discountPrice: {
      type: Number,
      default: 0
    },
    duration: {
      type: String,
      required: true,
      default: "1 Month"
    },
    accessType: {
      type: String,
      enum: ["credentials", "invite_link", "license_key", "download_link"],
      default: "credentials"
    },
    description: {
      type: String,
      required: true
    },
    features: {
      type: [String],
      default: []
    },
    stockQuantity: {
      type: Number,
      default: 100
    },
    image: {
      type: String,
      default: ""
    },
    bannerColor: {
      type: String,
      default: "from-blue-600 to-indigo-600"
    },
    deliveryTimeText: {
      type: String,
      default: "Instant / 1-15 Mins"
    },
    isActive: {
      type: Boolean,
      default: true
    },
    isPopular: {
      type: Boolean,
      default: false
    },
    averageRating: {
      type: Number,
      default: 5,
      min: 1,
      max: 5
    },
    totalReviews: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);
var Product = mongoose5.model("Product", ProductSchema);

// src/models/Category.ts
import mongoose6, { Schema as Schema5 } from "mongoose";
var CategorySchema = new Schema5(
  {
    name: {
      type: String,
      required: [true, "Category name is required"],
      unique: true,
      trim: true
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    description: {
      type: String,
      default: ""
    },
    icon: {
      type: String,
      default: "Sparkles"
    },
    isFeatured: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);
var Category = mongoose6.model("Category", CategorySchema);

// src/routes/productRoutes.ts
var router2 = Router2();
async function resolveCategoryId(categoryInput) {
  if (!categoryInput) throw new Error("Category is required");
  if (typeof categoryInput === "string" && categoryInput.match(/^[0-9a-fA-F]{24}$/)) {
    return categoryInput;
  }
  const found = await Category.findOne({ slug: categoryInput });
  if (found) return found._id.toString();
  let defaultCat = await Category.findOne();
  if (!defaultCat) {
    defaultCat = await Category.create({
      name: categoryInput,
      slug: categoryInput.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-"),
      description: "General Category"
    });
  }
  return defaultCat._id.toString();
}
router2.get("/", async (req, res) => {
  try {
    const { category, search, popular, all } = req.query;
    let query = {};
    if (all !== "true") {
      query.isActive = true;
    }
    if (category) {
      let catFilter = { slug: category };
      if (typeof category === "string" && category.match(/^[0-9a-fA-F]{24}$/)) {
        catFilter = { $or: [{ _id: category }, { slug: category }] };
      }
      const foundCategory = await Category.findOne(catFilter);
      if (foundCategory) {
        query.category = foundCategory._id;
      }
    }
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } }
      ];
    }
    if (popular === "true") {
      query.isPopular = true;
    }
    const products = await Product.find(query).populate("category", "name slug icon").sort({ createdAt: -1 });
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router2.get("/:idOrSlug", async (req, res) => {
  try {
    const param = req.params.idOrSlug;
    let product;
    if (param.match(/^[0-9a-fA-F]{24}$/)) {
      product = await Product.findById(param).populate("category", "name slug icon");
    } else {
      product = await Product.findOne({ slug: param }).populate("category", "name slug icon");
    }
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
var VALID_ACCESS_TYPES = ["credentials", "invite_link", "license_key", "download_link"];
router2.post("/", protect, isAdmin, async (req, res) => {
  try {
    const {
      title,
      category,
      price,
      discountPrice,
      duration,
      accessType,
      description,
      features,
      stockQuantity,
      image,
      isPopular,
      deliveryTimeText,
      isActive
    } = req.body;
    if (!title || !category || price === void 0) {
      return res.status(400).json({ success: false, message: "Title, category, and price are required" });
    }
    const categoryId = await resolveCategoryId(category);
    const slug = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-") + "-" + Math.floor(1e3 + Math.random() * 9e3);
    const safeAccessType = VALID_ACCESS_TYPES.includes(accessType) ? accessType : "credentials";
    const product = await Product.create({
      title,
      slug,
      category: categoryId,
      price: Number(price),
      discountPrice: discountPrice !== void 0 ? Number(discountPrice) : 0,
      duration: duration || "1 Month",
      accessType: safeAccessType,
      description: description || title,
      features: Array.isArray(features) ? features : [],
      stockQuantity: stockQuantity !== void 0 ? Number(stockQuantity) : 100,
      image: image || "",
      isPopular: !!isPopular,
      deliveryTimeText: deliveryTimeText || "Instant Delivery (1-10 Mins)",
      isActive: isActive !== void 0 ? !!isActive : true
    });
    const populatedProduct = await Product.findById(product._id).populate("category", "name slug icon");
    res.status(201).json({ success: true, product: populatedProduct });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router2.put("/:id", protect, isAdmin, async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (updateData.category) {
      updateData.category = await resolveCategoryId(updateData.category);
    }
    if (updateData.accessType && !VALID_ACCESS_TYPES.includes(updateData.accessType)) {
      updateData.accessType = "credentials";
    }
    if (updateData.price !== void 0) updateData.price = Number(updateData.price);
    if (updateData.discountPrice !== void 0) updateData.discountPrice = Number(updateData.discountPrice);
    if (updateData.stockQuantity !== void 0) updateData.stockQuantity = Number(updateData.stockQuantity);
    const product = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true }).populate("category", "name slug icon");
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router2.patch("/:id/toggle-active", protect, isAdmin, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    product.isActive = !product.isActive;
    await product.save();
    const populated = await Product.findById(product._id).populate("category", "name slug icon");
    res.json({ success: true, message: `Product ${product.isActive ? "Activated" : "Hidden"}`, product: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router2.post("/:id/duplicate", protect, isAdmin, async (req, res) => {
  try {
    const original = await Product.findById(req.params.id);
    if (!original) return res.status(404).json({ success: false, message: "Original product not found" });
    const newTitle = `${original.title} (Copy)`;
    const newSlug = original.title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-") + "-copy-" + Math.floor(1e3 + Math.random() * 9e3);
    const duplicate = await Product.create({
      title: newTitle,
      slug: newSlug,
      category: original.category,
      price: original.price,
      discountPrice: original.discountPrice,
      duration: original.duration,
      accessType: original.accessType,
      description: original.description,
      features: original.features,
      stockQuantity: original.stockQuantity,
      image: original.image,
      deliveryTimeText: original.deliveryTimeText,
      isActive: true,
      isPopular: false
    });
    const populated = await Product.findById(duplicate._id).populate("category", "name slug icon");
    res.status(201).json({ success: true, product: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router2.delete("/:id", protect, isAdmin, async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Product deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
var productRoutes_default = router2;

// src/routes/categoryRoutes.ts
import { Router as Router3 } from "express";
var router3 = Router3();
router3.get("/", async (req, res) => {
  try {
    const categories = await Category.find().sort({ name: 1 });
    res.json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router3.post("/", protect, isAdmin, async (req, res) => {
  try {
    const { name, description, icon, isFeatured } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Category name is required" });
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
    const category = await Category.create({
      name,
      slug,
      description: description || "",
      icon: icon || "Sparkles",
      isFeatured: isFeatured !== void 0 ? isFeatured : true
    });
    res.status(201).json({ success: true, category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router3.delete("/:id", protect, isAdmin, async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Category removed" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
var categoryRoutes_default = router3;

// src/routes/orderRoutes.ts
import { Router as Router4 } from "express";

// src/models/Order.ts
import mongoose7, { Schema as Schema6 } from "mongoose";
var OrderSchema = new Schema6(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true
    },
    user: {
      type: Schema6.Types.ObjectId,
      ref: "User",
      required: true
    },
    customerName: {
      type: String,
      required: true
    },
    customerEmail: {
      type: String,
      required: true
    },
    customerPhone: {
      type: String,
      required: true
    },
    items: [
      {
        product: {
          type: Schema6.Types.ObjectId,
          ref: "Product",
          required: true
        },
        title: { type: String, required: true },
        image: { type: String, default: "" },
        category: { type: String, default: "" },
        price: { type: Number, required: true },
        discount: { type: Number, default: 0 },
        quantity: { type: Number, default: 1 },
        duration: { type: String, default: "1 Month" },
        accessType: { type: String, default: "Shared" },
        finalAmount: { type: Number, default: 0 }
      }
    ],
    totalAmount: {
      type: Number,
      required: true
    },
    discountAmount: {
      type: Number,
      default: 0
    },
    couponCode: {
      type: String,
      default: ""
    },
    paymentMethod: {
      type: String,
      enum: ["bKash", "Nagad", "Rocket", "FastPay"],
      required: true,
      default: "FastPay"
    },
    transactionId: {
      type: String,
      required: false,
      default: "",
      trim: true
    },
    senderPhone: {
      type: String,
      required: false,
      default: "",
      trim: true
    },
    paymentScreenshot: {
      type: String,
      default: ""
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "verified", "rejected", "refunded"],
      default: "pending"
    },
    orderStatus: {
      type: String,
      enum: ["pending", "processing", "completed", "cancelled"],
      default: "pending"
    },
    deliveryStatus: {
      type: String,
      enum: ["pending", "processing", "delivered", "cancelled"],
      default: "pending"
    },
    fastpaySessionId: {
      type: String,
      default: "",
      trim: true
    },
    paymentProvider: {
      type: String,
      default: "",
      trim: true
    },
    deliveredCredentials: [
      {
        label: String,
        value: String
      }
    ],
    deliveryInstructions: {
      type: String,
      default: ""
    },
    adminNotes: {
      type: String,
      default: ""
    },
    rejectionReason: {
      type: String,
      default: ""
    },
    verifiedBy: {
      type: Schema6.Types.ObjectId,
      ref: "User"
    },
    assignedTo: {
      type: Schema6.Types.ObjectId,
      ref: "User"
    },
    completedAt: Date,
    timeline: [
      {
        status: String,
        note: String,
        updatedBy: String,
        timestamp: { type: Date, default: Date.now }
      }
    ]
  },
  {
    timestamps: true
  }
);
OrderSchema.index({ user: 1 });
OrderSchema.index({ orderStatus: 1 });
OrderSchema.index({ paymentStatus: 1 });
OrderSchema.index({ transactionId: 1 });
OrderSchema.index({ fastpaySessionId: 1 });
OrderSchema.index({ createdAt: -1 });
var Order = mongoose7.model("Order", OrderSchema);

// src/models/Payment.ts
import mongoose8, { Schema as Schema7 } from "mongoose";
var PaymentSchema = new Schema7(
  {
    order: {
      type: Schema7.Types.ObjectId,
      ref: "Order",
      required: true
    },
    user: {
      type: Schema7.Types.ObjectId,
      ref: "User",
      required: true
    },
    paymentMethod: {
      type: String,
      enum: ["bKash", "Nagad", "Rocket", "FastPay"],
      required: true,
      default: "FastPay"
    },
    transactionId: {
      type: String,
      required: false,
      default: "",
      trim: true
    },
    senderPhone: {
      type: String,
      required: false,
      default: "",
      trim: true
    },
    amount: {
      type: Number,
      required: true
    },
    paymentScreenshot: {
      type: String,
      default: ""
    },
    status: {
      type: String,
      enum: ["pending", "verified", "rejected", "refunded"],
      default: "pending"
    },
    rejectionReason: {
      type: String,
      default: ""
    },
    adminNotes: {
      type: String,
      default: ""
    },
    verifiedBy: {
      type: Schema7.Types.ObjectId,
      ref: "User"
    },
    verifiedAt: Date
  },
  {
    timestamps: true
  }
);
PaymentSchema.index({ order: 1 });
PaymentSchema.index({ user: 1 });
PaymentSchema.index({ status: 1 });
PaymentSchema.index({ transactionId: 1 });
PaymentSchema.index({ createdAt: -1 });
var Payment = mongoose8.model("Payment", PaymentSchema);

// src/models/Notification.ts
import mongoose9, { Schema as Schema8 } from "mongoose";
var NotificationSchema = new Schema8(
  {
    user: {
      type: Schema8.Types.ObjectId,
      ref: "User",
      required: true
    },
    title: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ["order", "payment", "ticket", "system"],
      default: "system"
    },
    link: {
      type: String,
      default: ""
    },
    isRead: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);
var Notification = mongoose9.model("Notification", NotificationSchema);

// src/routes/orderRoutes.ts
var router4 = Router4();
router4.post("/", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const {
      customerName,
      customerEmail,
      customerPhone,
      items,
      totalAmount,
      discountAmount,
      couponCode,
      paymentMethod,
      transactionId,
      senderPhone,
      paymentScreenshot
    } = req.body;
    if (!items || !items.length || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: "Items and payment method are required"
      });
    }
    const isFastPay = paymentMethod === "FastPay";
    if (!isFastPay && (!transactionId || !senderPhone)) {
      return res.status(400).json({
        success: false,
        message: "Transaction ID and sender phone are required for manual payment methods"
      });
    }
    const normalizedTrxId = (transactionId || "").trim().toUpperCase();
    const senderPhoneVal = (senderPhone || customerPhone || req.user.phone || "").trim();
    if (!isFastPay && normalizedTrxId) {
      const existingOrder = await Order.findOne({ transactionId: normalizedTrxId });
      if (existingOrder) {
        const existingPayment = await Payment.findOne({ order: existingOrder._id });
        return res.status(200).json({
          success: true,
          message: "Order already created for this Transaction ID",
          order: existingOrder,
          payment: existingPayment
        });
      }
    }
    const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(1e3 + Math.random() * 9e3);
    const orderNumber = `SUB-${dateStr}-${randomSuffix}`;
    const formattedItems = items.map((item) => ({
      product: item.product,
      title: item.title,
      image: item.image || "",
      category: item.category || "",
      price: Number(item.price) || 0,
      discount: Number(item.discount) || 0,
      quantity: Number(item.quantity) || 1,
      duration: item.duration || "1 Month",
      accessType: item.accessType || "Shared",
      finalAmount: (Number(item.price) || 0) * (Number(item.quantity) || 1)
    }));
    const order = await Order.create({
      orderNumber,
      user: req.user._id,
      customerName: customerName || req.user.name,
      customerEmail: customerEmail || req.user.email,
      customerPhone: customerPhone || req.user.phone || senderPhoneVal,
      items: formattedItems,
      totalAmount: Number(totalAmount) || 0,
      discountAmount: Number(discountAmount) || 0,
      couponCode: couponCode || "",
      paymentMethod,
      paymentProvider: isFastPay ? "FastPay" : paymentMethod,
      transactionId: normalizedTrxId,
      senderPhone: senderPhoneVal,
      paymentScreenshot: paymentScreenshot || "",
      paymentStatus: "pending",
      orderStatus: "pending",
      deliveryStatus: "pending"
    });
    const payment = await Payment.create({
      order: order._id,
      user: req.user._id,
      paymentMethod,
      transactionId: normalizedTrxId,
      senderPhone: senderPhoneVal,
      amount: Number(totalAmount) || 0,
      paymentScreenshot: paymentScreenshot || "",
      status: "pending"
    });
    (async () => {
      try {
        await ActivityLog.create({
          user: req.user?._id,
          userName: req.user?.name,
          action: "Order Created",
          details: `Created Order #${order.orderNumber} for \u09F3${order.totalAmount} (${paymentMethod})`
        });
        await ActivityLog.create({
          user: req.user?._id,
          userName: req.user?.name,
          action: "Payment Submitted",
          details: `Submitted ${paymentMethod} payment TrxID: ${transactionId} for Order #${order.orderNumber}`
        });
        await Notification.create({
          user: req.user?._id,
          title: "Order Placed Successfully!",
          message: `Your order #${order.orderNumber} has been submitted with ${paymentMethod} Trx ID: ${transactionId}. Admin will verify shortly.`,
          type: "order",
          link: "/user/orders"
        });
        const adminUsers = await User.find({ role: "admin" }).select("_id");
        for (const admin of adminUsers) {
          await Notification.create({
            user: admin._id,
            title: "\u{1F514} New Order Received",
            message: `${formattedItems[0]?.title || "Product"} ordered by ${order.customerName} (\u09F3${order.totalAmount})`,
            type: "order",
            link: "/admin/orders"
          });
        }
        const io2 = getIO();
        if (io2) {
          const pendingOrdersCount = await Order.countDocuments({ orderStatus: "pending" });
          const pendingPaymentsCount = await Payment.countDocuments({ status: "pending" });
          const startOfToday = /* @__PURE__ */ new Date();
          startOfToday.setHours(0, 0, 0, 0);
          const todayOrders = await Order.find({ paymentStatus: "verified", createdAt: { $gte: startOfToday } });
          const todaysRevenueBDT = todayOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
          const startOfMonth = /* @__PURE__ */ new Date();
          startOfMonth.setDate(1);
          startOfMonth.setHours(0, 0, 0, 0);
          const monthOrders = await Order.find({ paymentStatus: "verified", createdAt: { $gte: startOfMonth } });
          const monthlyRevenueBDT = monthOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
          const allVerifiedOrders = await Order.find({ paymentStatus: "verified" });
          const totalRevenueBDT = allVerifiedOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
          const socketPayload = {
            order,
            payment,
            pendingOrdersCount,
            pendingPaymentsCount,
            todaysRevenueBDT,
            monthlyRevenueBDT,
            totalRevenueBDT
          };
          io2.to("admin_room").emit("new-order", socketPayload);
          io2.to("admin_room").emit("pending-order-count", { pendingOrdersCount, pendingPaymentsCount });
          io2.to("admin_room").emit("dashboard-update", socketPayload);
          io2.to("admin_room").emit("notification", {
            title: "\u{1F514} New Order Received",
            message: `${formattedItems[0]?.title || "Product"} - Customer: ${order.customerName}`,
            order,
            createdAt: order.createdAt
          });
          io2.to("admin_room").emit("order:created", {
            orderId: order._id,
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            totalAmount: order.totalAmount,
            paymentMethod: order.paymentMethod,
            transactionId: order.transactionId
          });
          io2.to(`user_${req.user?._id}`).emit("notification:new", {
            title: "Order Placed Successfully",
            message: `Order #${order.orderNumber} placed successfully.`
          });
        }
      } catch (secondaryErr) {
        console.error("Non-critical secondary task error during order creation:", secondaryErr);
      }
    })();
    res.status(201).json({ success: true, order, payment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router4.get("/my-orders", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router4.get("/track/:query", async (req, res) => {
  try {
    const q = req.params.query.trim();
    const orders = await Order.find({
      $or: [{ orderNumber: q }, { customerPhone: q }, { transactionId: q }]
    }).select("orderNumber customerName items totalAmount paymentMethod paymentStatus orderStatus deliveryStatus createdAt deliveredCredentials deliveryInstructions").sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router4.get("/", protect, isAdmin, async (req, res) => {
  try {
    const { status, paymentStatus, search, sortBy, sortOrder, page = 1, limit = 50 } = req.query;
    let queryFilter = {};
    if (status) queryFilter.orderStatus = status;
    if (paymentStatus) queryFilter.paymentStatus = paymentStatus;
    if (search && typeof search === "string" && search.trim()) {
      const q = search.trim();
      queryFilter.$or = [
        { orderNumber: { $regex: q, $options: "i" } },
        { customerName: { $regex: q, $options: "i" } },
        { customerEmail: { $regex: q, $options: "i" } },
        { customerPhone: { $regex: q, $options: "i" } },
        { transactionId: { $regex: q, $options: "i" } },
        { senderPhone: { $regex: q, $options: "i" } }
      ];
    }
    const sortField = sortBy || "createdAt";
    const sortDir = sortOrder === "asc" ? 1 : -1;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 50);
    const skip = (pageNum - 1) * limitNum;
    const totalCount = await Order.countDocuments(queryFilter);
    const orders = await Order.find(queryFilter).populate("user", "name email phone").sort({ [sortField]: sortDir }).skip(skip).limit(limitNum);
    res.json({
      success: true,
      orders,
      pagination: {
        totalCount,
        page: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        limit: limitNum
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router4.put("/:id/approve", protect, isAdmin, async (req, res) => {
  try {
    const { deliveredCredentials, deliveryInstructions, adminNotes } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    order.paymentStatus = "verified";
    order.orderStatus = "completed";
    order.deliveryStatus = "delivered";
    if (deliveredCredentials) order.deliveredCredentials = deliveredCredentials;
    if (deliveryInstructions !== void 0) order.deliveryInstructions = deliveryInstructions;
    if (adminNotes !== void 0) order.adminNotes = adminNotes;
    order.verifiedBy = req.user?._id;
    order.completedAt = /* @__PURE__ */ new Date();
    await order.save();
    await Payment.findOneAndUpdate(
      { order: order._id },
      {
        status: "verified",
        verifiedBy: req.user?._id,
        verifiedAt: /* @__PURE__ */ new Date(),
        adminNotes: adminNotes || ""
      }
    );
    (async () => {
      try {
        await ActivityLog.create({
          user: req.user?._id,
          userName: req.user?.name,
          action: "Payment Approved",
          details: `Approved payment & verified TrxID ${order.transactionId} for Order #${order.orderNumber}`
        });
        await ActivityLog.create({
          user: req.user?._id,
          userName: req.user?.name,
          action: "Product Delivered",
          details: `Delivered login credentials for Order #${order.orderNumber} to ${order.customerEmail}`
        });
        await Notification.create({
          user: order.user,
          title: "\u{1F389} Order Approved & Credentials Delivered!",
          message: `Your order #${order.orderNumber} is completed! Access your account credentials/keys in your User Dashboard now.`,
          type: "order",
          link: "/user/orders"
        });
        const reviewProdId = order.items && order.items.length > 0 ? order.items[0].product : null;
        await Notification.create({
          user: order.user,
          title: "\u2B50 Share Your Experience!",
          message: "Your order has been completed. Please share your experience by leaving a review.",
          type: "order",
          link: reviewProdId ? `/products/${reviewProdId}` : "/user/orders"
        });
        const io2 = getIO();
        if (io2) {
          io2.to(`user_${order.user}`).emit("order:updated", {
            orderId: order._id,
            orderNumber: order.orderNumber,
            status: "completed",
            credentials: order.deliveredCredentials
          });
          io2.to(`user_${order.user}`).emit("notification:new", {
            title: "Order Completed!",
            message: `Credentials delivered for #${order.orderNumber}.`
          });
        }
      } catch (secondaryErr) {
        console.error("Non-critical secondary task error on order approve:", secondaryErr);
      }
    })();
    res.json({ success: true, message: "Order approved and delivered successfully", order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router4.patch("/:id/status", protect, isAdmin, async (req, res) => {
  try {
    const { orderStatus, paymentStatus, deliveryStatus, deliveredCredentials, deliveryInstructions, adminNotes } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (orderStatus) order.orderStatus = orderStatus;
    if (paymentStatus) order.paymentStatus = paymentStatus;
    if (deliveryStatus) order.deliveryStatus = deliveryStatus;
    if (deliveredCredentials) order.deliveredCredentials = deliveredCredentials;
    if (deliveryInstructions !== void 0) order.deliveryInstructions = deliveryInstructions;
    if (adminNotes !== void 0) order.adminNotes = adminNotes;
    if (orderStatus === "completed") {
      order.paymentStatus = "verified";
      order.deliveryStatus = "delivered";
      order.completedAt = /* @__PURE__ */ new Date();
    } else if (orderStatus === "cancelled") {
      order.paymentStatus = order.paymentStatus === "refunded" ? "refunded" : "rejected";
      order.deliveryStatus = "cancelled";
    }
    order.verifiedBy = req.user?._id;
    await order.save();
    let payStatus = "pending";
    if (order.paymentStatus === "verified") payStatus = "verified";
    else if (order.paymentStatus === "rejected") payStatus = "rejected";
    else if (order.paymentStatus === "refunded") payStatus = "refunded";
    await Payment.findOneAndUpdate(
      { order: order._id },
      {
        status: payStatus,
        verifiedBy: req.user?._id,
        verifiedAt: payStatus === "verified" ? /* @__PURE__ */ new Date() : void 0,
        adminNotes: adminNotes || ""
      }
    );
    await ActivityLog.create({
      user: req.user?._id,
      userName: req.user?.name,
      action: orderStatus === "completed" ? "Product Delivered" : "Order Updated",
      details: `Updated Order #${order.orderNumber} status to ${orderStatus} (Payment: ${order.paymentStatus})`
    });
    await Notification.create({
      user: order.user,
      title: `Order #${order.orderNumber} ${orderStatus.toUpperCase()}`,
      message: `Your order status has been updated to ${orderStatus}. Check details in dashboard.`,
      type: "order",
      link: "/user/orders"
    });
    if (orderStatus === "completed") {
      const reviewProdId = order.items && order.items.length > 0 ? order.items[0].product : null;
      await Notification.create({
        user: order.user,
        title: "\u2B50 Share Your Experience!",
        message: "Your order has been completed. Please share your experience by leaving a review.",
        type: "order",
        link: reviewProdId ? `/products/${reviewProdId}` : "/user/orders"
      });
    }
    res.json({ success: true, message: "Order status updated successfully", order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router4.put("/:id/reject", protect, isAdmin, async (req, res) => {
  try {
    const { rejectionReason } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    const reason = rejectionReason || "Transaction ID not verified or payment not received.";
    order.paymentStatus = "rejected";
    order.orderStatus = "cancelled";
    order.deliveryStatus = "cancelled";
    order.adminNotes = reason;
    await order.save();
    await Payment.findOneAndUpdate(
      { order: order._id },
      {
        status: "rejected",
        rejectionReason: reason,
        adminNotes: reason,
        verifiedBy: req.user?._id
      }
    );
    await ActivityLog.create({
      user: req.user?._id,
      userName: req.user?.name,
      action: "Payment Rejected",
      details: `Rejected payment for Order #${order.orderNumber}. Reason: ${reason}`
    });
    await Notification.create({
      user: order.user,
      title: "\u274C Order Cancelled / Payment Rejected",
      message: `Your order #${order.orderNumber} was cancelled. Reason: ${reason}`,
      type: "order",
      link: "/user/orders"
    });
    const io2 = getIO();
    if (io2) {
      io2.to(`user_${order.user}`).emit("order:updated", {
        orderId: order._id,
        status: "cancelled",
        reason
      });
    }
    res.json({ success: true, message: "Order rejected successfully", order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router4.get("/:id", protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate("user", "name email phone avatar").populate("verifiedBy", "name email").populate("assignedTo", "name email");
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (req.user?.role !== "admin" && order.user._id.toString() !== req.user?._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized to view this order" });
    }
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router4.patch("/:id/notes", protect, isAdmin, async (req, res) => {
  try {
    const { adminNotes } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    order.adminNotes = adminNotes || "";
    await order.save();
    res.json({ success: true, message: "Internal notes updated", order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router4.patch("/:id/assign", protect, isAdmin, async (req, res) => {
  try {
    const { staffId } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    order.assignedTo = staffId || null;
    await order.save();
    res.json({ success: true, message: "Staff assigned successfully", order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router4.delete("/:id", protect, isAdmin, async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    await Payment.deleteMany({ order: req.params.id });
    await ActivityLog.create({
      user: req.user?._id,
      userName: req.user?.name,
      action: "Order Deleted",
      details: `Deleted Order #${order.orderNumber} (\u09F3${order.totalAmount})`
    });
    res.json({ success: true, message: "Order and payment deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
var orderRoutes_default = router4;

// src/routes/paymentRoutes.ts
import { Router as Router5 } from "express";
var router5 = Router5();
router5.get("/", protect, isAdmin, async (req, res) => {
  try {
    const { status, search } = req.query;
    let filter = {};
    if (status) filter.status = status;
    if (search && typeof search === "string" && search.trim()) {
      const q = search.trim();
      filter.$or = [
        { transactionId: { $regex: q, $options: "i" } },
        { senderPhone: { $regex: q, $options: "i" } },
        { paymentMethod: { $regex: q, $options: "i" } }
      ];
    }
    const payments = await Payment.find(filter).populate("user", "name email phone").populate("order", "orderNumber totalAmount paymentStatus orderStatus customerName customerEmail customerPhone items createdAt paymentScreenshot senderPhone paymentMethod transactionId").sort({ createdAt: -1 });
    res.json({ success: true, payments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router5.put("/:id/approve", protect, isAdmin, async (req, res) => {
  try {
    const { deliveredCredentials, deliveryInstructions, adminNotes } = req.body;
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: "Payment record not found" });
    payment.status = "verified";
    payment.verifiedBy = req.user?._id;
    payment.verifiedAt = /* @__PURE__ */ new Date();
    if (adminNotes) payment.adminNotes = adminNotes;
    await payment.save();
    const order = await Order.findById(payment.order);
    if (order) {
      order.paymentStatus = "verified";
      order.orderStatus = "completed";
      order.deliveryStatus = "delivered";
      if (deliveredCredentials) order.deliveredCredentials = deliveredCredentials;
      if (deliveryInstructions) order.deliveryInstructions = deliveryInstructions;
      if (adminNotes) order.adminNotes = adminNotes;
      order.verifiedBy = req.user?._id;
      order.completedAt = /* @__PURE__ */ new Date();
      await order.save();
      (async () => {
        try {
          await ActivityLog.create({
            user: req.user?._id,
            userName: req.user?.name,
            action: "Payment Approved",
            details: `Approved payment for TrxID ${payment.transactionId} (Order #${order.orderNumber})`
          });
          await Notification.create({
            user: order.user,
            title: "\u{1F389} Payment Verified & Order Delivered!",
            message: `Your payment for order #${order.orderNumber} has been verified. Login credentials are available in your account.`,
            type: "order",
            link: "/user/orders"
          });
          const io2 = getIO();
          if (io2) {
            const pendingOrdersCount = await Order.countDocuments({ orderStatus: "pending" });
            const pendingPaymentsCount = await Payment.countDocuments({ status: "pending" });
            const startOfToday = /* @__PURE__ */ new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const todayOrders = await Order.find({ paymentStatus: "verified", createdAt: { $gte: startOfToday } });
            const todaysRevenueBDT = todayOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
            const startOfMonth = /* @__PURE__ */ new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);
            const monthOrders = await Order.find({ paymentStatus: "verified", createdAt: { $gte: startOfMonth } });
            const monthlyRevenueBDT = monthOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
            const allVerifiedOrders = await Order.find({ paymentStatus: "verified" });
            const totalRevenueBDT = allVerifiedOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
            const socketPayload = {
              paymentId: payment._id,
              orderId: order._id,
              orderNumber: order.orderNumber,
              status: "verified",
              pendingOrdersCount,
              pendingPaymentsCount,
              todaysRevenueBDT,
              monthlyRevenueBDT,
              totalRevenueBDT
            };
            io2.to("admin_room").emit("payment-approved", socketPayload);
            io2.to("admin_room").emit("pending-order-count", { pendingOrdersCount, pendingPaymentsCount });
            io2.to("admin_room").emit("dashboard-update", socketPayload);
            io2.to(`user_${order.user}`).emit("payment-approved", socketPayload);
            io2.to(`user_${order.user}`).emit("order:updated", {
              orderId: order._id,
              orderNumber: order.orderNumber,
              status: "completed"
            });
          }
        } catch (secondaryErr) {
          console.error("Non-critical secondary task error on payment approval:", secondaryErr);
        }
      })();
    }
    res.json({ success: true, message: "Payment approved successfully", payment, order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router5.put("/:id/reject", protect, isAdmin, async (req, res) => {
  try {
    const { rejectionReason } = req.body;
    const reason = rejectionReason || "Invalid Transaction ID or payment not received.";
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: "Payment record not found" });
    payment.status = "rejected";
    payment.rejectionReason = reason;
    payment.adminNotes = reason;
    payment.verifiedBy = req.user?._id;
    await payment.save();
    const order = await Order.findById(payment.order);
    if (order) {
      order.paymentStatus = "rejected";
      order.orderStatus = "cancelled";
      order.deliveryStatus = "cancelled";
      order.adminNotes = reason;
      await order.save();
      (async () => {
        try {
          await ActivityLog.create({
            user: req.user?._id,
            userName: req.user?.name,
            action: "Payment Rejected",
            details: `Rejected payment TrxID ${payment.transactionId} for Order #${order.orderNumber}. Reason: ${reason}`
          });
          await Notification.create({
            user: order.user,
            title: "\u274C Payment Rejected",
            message: `Your payment for order #${order.orderNumber} was rejected. Reason: ${reason}`,
            type: "order",
            link: "/user/orders"
          });
          const io2 = getIO();
          if (io2) {
            const pendingOrdersCount = await Order.countDocuments({ orderStatus: "pending" });
            const pendingPaymentsCount = await Payment.countDocuments({ status: "pending" });
            const socketPayload = {
              paymentId: payment._id,
              orderId: order._id,
              orderNumber: order.orderNumber,
              status: "rejected",
              reason,
              pendingOrdersCount,
              pendingPaymentsCount
            };
            io2.to("admin_room").emit("payment-rejected", socketPayload);
            io2.to("admin_room").emit("pending-order-count", { pendingOrdersCount, pendingPaymentsCount });
            io2.to("admin_room").emit("dashboard-update", socketPayload);
            io2.to(`user_${order.user}`).emit("payment-rejected", socketPayload);
          }
        } catch (secondaryErr) {
          console.error("Non-critical secondary task error on payment rejection:", secondaryErr);
        }
      })();
    }
    res.json({ success: true, message: "Payment rejected successfully", payment, order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
var paymentRoutes_default = router5;

// src/routes/couponRoutes.ts
import { Router as Router6 } from "express";

// src/models/Coupon.ts
import mongoose10, { Schema as Schema9 } from "mongoose";
var CouponSchema = new Schema9(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true
    },
    discountPercentage: {
      type: Number,
      default: 0
    },
    discountType: {
      type: String,
      enum: ["percent", "fixed"],
      default: "percent"
    },
    discountValue: {
      type: Number,
      default: 0
    },
    minOrderAmount: {
      type: Number,
      default: 0
    },
    maxDiscountBDT: {
      type: Number,
      default: 5e3
    },
    minSpendBDT: {
      type: Number,
      default: 0
    },
    expiresAt: {
      type: Date,
      required: true
    },
    usageLimit: {
      type: Number,
      default: 1e3
    },
    usageCount: {
      type: Number,
      default: 0
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);
var Coupon = mongoose10.model("Coupon", CouponSchema);

// src/routes/couponRoutes.ts
var router6 = Router6();
router6.post("/apply", async (req, res) => {
  try {
    const { code, cartTotal } = req.body;
    if (!code) return res.status(400).json({ success: false, message: "Coupon code required" });
    const coupon = await Coupon.findOne({ code: code.toUpperCase().trim(), isActive: true });
    if (!coupon) {
      return res.status(400).json({ success: false, message: "Invalid or inactive coupon code" });
    }
    if (coupon.expiresAt && /* @__PURE__ */ new Date() > new Date(coupon.expiresAt)) {
      return res.status(400).json({ success: false, message: "Coupon code has expired" });
    }
    const minSpend = coupon.minSpendBDT || coupon.minOrderAmount || 0;
    if (minSpend && cartTotal < minSpend) {
      return res.status(400).json({ success: false, message: `Minimum cart total of \u09F3${minSpend} required for this coupon` });
    }
    let discount = 0;
    const isFixed = coupon.discountType === "fixed";
    if (isFixed) {
      discount = coupon.discountValue || coupon.discountPercentage || 0;
    } else {
      const pct = coupon.discountValue || coupon.discountPercentage || 0;
      discount = cartTotal * pct / 100;
      if (coupon.maxDiscountBDT && discount > coupon.maxDiscountBDT) {
        discount = coupon.maxDiscountBDT;
      }
    }
    if (discount > cartTotal) discount = cartTotal;
    res.json({
      success: true,
      message: `Coupon Applied! Saved \u09F3${Math.round(discount)}`,
      couponCode: coupon.code,
      discountAmount: Math.round(discount),
      discountPercentage: coupon.discountPercentage
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router6.get("/", protect, isAdmin, async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    res.json({ success: true, coupons });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router6.post("/", protect, isAdmin, async (req, res) => {
  try {
    const {
      code,
      discountType,
      discountValue,
      discountPercentage,
      maxDiscountBDT,
      minSpendBDT,
      minOrderAmount,
      expiresAt,
      usageLimit
    } = req.body;
    if (!code) return res.status(400).json({ success: false, message: "Coupon code is required" });
    const codeUpper = code.toUpperCase().trim();
    const existing = await Coupon.findOne({ code: codeUpper });
    if (existing) {
      return res.status(400).json({ success: false, message: "Coupon code already exists" });
    }
    const val = discountValue !== void 0 ? Number(discountValue) : discountPercentage !== void 0 ? Number(discountPercentage) : 10;
    const type = discountType || "percent";
    const coupon = await Coupon.create({
      code: codeUpper,
      discountPercentage: type === "percent" ? val : 0,
      discountType: type,
      discountValue: val,
      minOrderAmount: minOrderAmount !== void 0 ? Number(minOrderAmount) : minSpendBDT !== void 0 ? Number(minSpendBDT) : 0,
      minSpendBDT: minSpendBDT !== void 0 ? Number(minSpendBDT) : minOrderAmount !== void 0 ? Number(minOrderAmount) : 0,
      maxDiscountBDT: maxDiscountBDT || 5e3,
      expiresAt: expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1e3),
      usageLimit: usageLimit || 1e3,
      isActive: true
    });
    res.status(201).json({ success: true, coupon });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router6.put("/:id", protect, isAdmin, async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found" });
    res.json({ success: true, coupon });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router6.patch("/:id/toggle", protect, isAdmin, async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found" });
    coupon.isActive = !coupon.isActive;
    await coupon.save();
    res.json({ success: true, message: `Coupon ${coupon.isActive ? "Activated" : "Disabled"}`, coupon });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router6.delete("/:id", protect, isAdmin, async (req, res) => {
  try {
    await Coupon.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Coupon deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
var couponRoutes_default = router6;

// src/routes/reviewRoutes.ts
import { Router as Router7 } from "express";
import mongoose12 from "mongoose";

// src/models/Review.ts
import mongoose11, { Schema as Schema10 } from "mongoose";
var ReviewSchema = new Schema10(
  {
    user: {
      type: Schema10.Types.ObjectId,
      ref: "User",
      required: true
    },
    userName: {
      type: String,
      required: true
    },
    userAvatar: {
      type: String,
      default: ""
    },
    product: {
      type: Schema10.Types.ObjectId,
      ref: "Product",
      required: true
    },
    order: {
      type: Schema10.Types.ObjectId,
      ref: "Order",
      required: true
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    comment: {
      type: String,
      required: true,
      trim: true
    },
    images: {
      type: [String],
      default: []
    },
    isVerifiedPurchase: {
      type: Boolean,
      default: true
    },
    isApproved: {
      type: Boolean,
      default: true
    },
    isHidden: {
      type: Boolean,
      default: false
    },
    isFeatured: {
      type: Boolean,
      default: false
    },
    helpfulVotes: {
      type: Number,
      default: 0
    },
    helpfulUsers: [
      {
        type: Schema10.Types.ObjectId,
        ref: "User"
      }
    ]
  },
  {
    timestamps: true
  }
);
ReviewSchema.index({ user: 1, product: 1, order: 1 }, { unique: true });
var Review = mongoose11.model("Review", ReviewSchema);

// src/routes/reviewRoutes.ts
var router7 = Router7();
var updateProductRatingStats = async (productId) => {
  try {
    const objId = new mongoose12.Types.ObjectId(productId);
    const stats = await Review.aggregate([
      { $match: { product: objId, isApproved: true, isHidden: { $ne: true } } },
      {
        $group: {
          _id: "$product",
          averageRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 }
        }
      }
    ]);
    if (stats.length > 0) {
      const avg = Math.round(stats[0].averageRating * 10) / 10;
      await Product.findByIdAndUpdate(productId, {
        averageRating: avg,
        totalReviews: stats[0].totalReviews
      });
    } else {
      await Product.findByIdAndUpdate(productId, {
        averageRating: 5,
        totalReviews: 0
      });
    }
  } catch (err) {
    console.error("Error updating product rating stats in MongoDB:", err);
  }
};
router7.get("/", async (req, res) => {
  try {
    const { productId, sort = "newest" } = req.query;
    let query = { isApproved: true, isHidden: { $ne: true } };
    if (productId) {
      query.product = productId;
    }
    let sortOptions = { createdAt: -1 };
    if (sort === "rating_high") sortOptions = { rating: -1, createdAt: -1 };
    else if (sort === "rating_low") sortOptions = { rating: 1, createdAt: -1 };
    else if (sort === "helpful") sortOptions = { helpfulVotes: -1, createdAt: -1 };
    const reviews = await Review.find(query).populate("user", "name avatar").populate("product", "title image price").sort(sortOptions);
    let stats = {
      averageRating: 5,
      totalReviews: reviews.length,
      ratingCounts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
    };
    if (productId) {
      const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      let sum = 0;
      reviews.forEach((r) => {
        const rRating = Math.min(5, Math.max(1, Math.round(r.rating)));
        counts[rRating] = (counts[rRating] || 0) + 1;
        sum += r.rating;
      });
      stats = {
        averageRating: reviews.length > 0 ? Math.round(sum / reviews.length * 10) / 10 : 5,
        totalReviews: reviews.length,
        ratingCounts: counts
      };
    }
    res.json({ success: true, reviews, stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router7.get("/eligibility", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const { productId } = req.query;
    if (!productId) {
      return res.status(400).json({ success: false, message: "Product ID is required" });
    }
    const completedOrder = await Order.findOne({
      user: req.user._id,
      orderStatus: "completed",
      "items.product": productId
    }).sort({ createdAt: -1 });
    if (!completedOrder) {
      return res.json({
        success: true,
        canReview: false,
        hasReviewed: false,
        message: "Only verified purchasers with a COMPLETED order for this product can write a review."
      });
    }
    const existingReview = await Review.findOne({
      user: req.user._id,
      product: productId
    });
    if (existingReview) {
      return res.json({
        success: true,
        canReview: true,
        hasReviewed: true,
        existingReview,
        orderId: completedOrder._id,
        orderNumber: completedOrder.orderNumber,
        message: "You have already reviewed this purchase. You can edit your review."
      });
    }
    return res.json({
      success: true,
      canReview: true,
      hasReviewed: false,
      orderId: completedOrder._id,
      orderNumber: completedOrder.orderNumber,
      message: "Verified Purchase Confirmed! You are eligible to submit a review."
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router7.post("/", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const { product, rating, title, comment, images } = req.body;
    if (!product || !rating || !title || !comment) {
      return res.status(400).json({
        success: false,
        message: "Product ID, rating (1-5), review title, and review description are required."
      });
    }
    const numRating = Number(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({ success: false, message: "Rating must be a number between 1 and 5." });
    }
    const completedOrder = await Order.findOne({
      user: req.user._id,
      orderStatus: "completed",
      "items.product": product
    }).sort({ createdAt: -1 });
    if (!completedOrder) {
      return res.status(403).json({
        success: false,
        message: "Access Denied: You can only review products from completed orders. Unverified or pending purchases cannot submit reviews."
      });
    }
    const existingReview = await Review.findOne({
      user: req.user._id,
      product
    });
    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: "You have already submitted a review for this product. You can update your existing review."
      });
    }
    const review = await Review.create({
      user: req.user._id,
      userName: req.user.name,
      userAvatar: req.user.avatar || "",
      product,
      order: completedOrder._id,
      rating: numRating,
      title: title.trim(),
      comment: comment.trim(),
      images: Array.isArray(images) ? images : [],
      isVerifiedPurchase: true,
      isApproved: true,
      isHidden: false
    });
    await updateProductRatingStats(product.toString());
    await ActivityLog.create({
      user: req.user._id,
      userName: req.user.name,
      action: "Submitted Review",
      details: `Submitted a ${numRating}-star verified purchase review for Product ID ${product}`
    });
    res.status(201).json({
      success: true,
      message: "Thank you! Your verified purchase review has been submitted.",
      review
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router7.put("/:id", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const { rating, title, comment, images } = req.body;
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ success: false, message: "Review not found" });
    }
    if (review.user.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Not authorized to edit this review" });
    }
    if (rating !== void 0) review.rating = Number(rating);
    if (title !== void 0) review.title = title.trim();
    if (comment !== void 0) review.comment = comment.trim();
    if (images !== void 0) review.images = Array.isArray(images) ? images : [];
    await review.save();
    await updateProductRatingStats(review.product.toString());
    res.json({ success: true, message: "Review updated successfully", review });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router7.post("/:id/helpful", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    const userIdStr = req.user._id.toString();
    const hasVoted = review.helpfulUsers.some((uId) => uId.toString() === userIdStr);
    if (hasVoted) {
      review.helpfulUsers = review.helpfulUsers.filter((uId) => uId.toString() !== userIdStr);
      review.helpfulVotes = Math.max(0, review.helpfulVotes - 1);
    } else {
      review.helpfulUsers.push(req.user._id);
      review.helpfulVotes += 1;
    }
    await review.save();
    res.json({
      success: true,
      helpfulVotes: review.helpfulVotes,
      hasVoted: !hasVoted
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router7.get("/admin/all", protect, isAdmin, async (req, res) => {
  try {
    const { search, filter } = req.query;
    let queryFilter = {};
    if (filter === "hidden") queryFilter.isHidden = true;
    else if (filter === "featured") queryFilter.isFeatured = true;
    if (search) {
      const searchRegex = new RegExp(search, "i");
      queryFilter.$or = [
        { userName: searchRegex },
        { title: searchRegex },
        { comment: searchRegex }
      ];
    }
    const reviews = await Review.find(queryFilter).populate("user", "name email avatar").populate("product", "title image price").populate("order", "orderNumber orderStatus").sort({ createdAt: -1 });
    res.json({ success: true, reviews });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router7.patch("/:id/toggle-hide", protect, isAdmin, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    review.isHidden = !review.isHidden;
    await review.save();
    await updateProductRatingStats(review.product.toString());
    res.json({
      success: true,
      message: review.isHidden ? "Review hidden from store" : "Review unhidden",
      isHidden: review.isHidden
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router7.patch("/:id/toggle-feature", protect, isAdmin, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    review.isFeatured = !review.isFeatured;
    await review.save();
    res.json({
      success: true,
      message: review.isFeatured ? "Review featured" : "Review unfeatured",
      isFeatured: review.isFeatured
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router7.delete("/:id", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    if (req.user.role !== "admin" && review.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this review" });
    }
    const productId = review.product.toString();
    await Review.findByIdAndDelete(req.params.id);
    await updateProductRatingStats(productId);
    res.json({ success: true, message: "Review deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
var reviewRoutes_default = router7;

// src/routes/ticketRoutes.ts
import { Router as Router8 } from "express";

// src/models/SupportTicket.ts
import mongoose13, { Schema as Schema11 } from "mongoose";
var SupportTicketSchema = new Schema11(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true
    },
    user: {
      type: Schema11.Types.ObjectId,
      ref: "User",
      required: true
    },
    customerName: {
      type: String,
      required: true,
      trim: true
    },
    customerEmail: {
      type: String,
      required: true,
      trim: true
    },
    customerPhone: {
      type: String,
      default: ""
    },
    subject: {
      type: String,
      required: true,
      trim: true
    },
    category: {
      type: String,
      default: "General Support"
    },
    orderNumber: {
      type: String,
      default: ""
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium"
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    attachments: [
      {
        type: String
      }
    ],
    status: {
      type: String,
      enum: ["open", "waiting_customer", "waiting_admin", "in_progress", "resolved", "closed", "reopened"],
      default: "open"
    },
    assignedStaff: {
      type: String,
      default: "Unassigned"
    },
    internalNotes: {
      type: String,
      default: ""
    },
    messages: [
      {
        sender: { type: Schema11.Types.ObjectId, ref: "User" },
        senderName: { type: String, required: true },
        senderEmail: { type: String, default: "" },
        senderRole: { type: String, enum: ["user", "admin"], default: "user" },
        message: { type: String, required: true },
        text: { type: String, default: "" },
        attachments: [{ type: String }],
        timestamp: { type: Date, default: Date.now },
        createdAt: { type: Date, default: Date.now },
        isRead: { type: Boolean, default: false }
      }
    ]
  },
  {
    timestamps: true
  }
);
var SupportTicket = mongoose13.model("SupportTicket", SupportTicketSchema);

// src/routes/ticketRoutes.ts
var router8 = Router8();
router8.post("/", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const { subject, category, orderNumber, priority, description, attachments } = req.body;
    const initialMessage = description || req.body.message;
    if (!subject || !initialMessage) {
      return res.status(400).json({ success: false, message: "Subject and issue description are required" });
    }
    const ticketId = "TICK-" + Math.floor(1e5 + Math.random() * 9e5);
    const now = /* @__PURE__ */ new Date();
    const formattedAttachments = Array.isArray(attachments) ? attachments : attachments ? [attachments] : [];
    const firstMessage = {
      sender: req.user._id,
      senderName: req.user.name,
      senderEmail: req.user.email,
      senderRole: req.user.role,
      message: initialMessage.trim(),
      text: initialMessage.trim(),
      attachments: formattedAttachments,
      timestamp: now,
      createdAt: now,
      isRead: true
    };
    const ticket = await SupportTicket.create({
      ticketId,
      user: req.user._id,
      customerName: req.user.name,
      customerEmail: req.user.email,
      customerPhone: req.user.phone || "",
      subject: subject.trim(),
      category: category || "General Support",
      orderNumber: orderNumber || "",
      priority: priority || "medium",
      description: initialMessage.trim(),
      attachments: formattedAttachments,
      status: "open",
      assignedStaff: "Unassigned",
      messages: [firstMessage]
    });
    (async () => {
      try {
        const admins = await User.find({ role: "admin" }).select("_id");
        for (const admin of admins) {
          await Notification.create({
            user: admin._id,
            title: "\u{1F4E9} New Support Ticket",
            message: `Ticket #${ticket.ticketId} created by ${req.user?.name}: "${subject}"`,
            type: "ticket",
            link: "/admin/support"
          });
        }
        const io2 = getIO();
        if (io2) {
          const pendingTicketsCount = await SupportTicket.countDocuments({
            status: { $in: ["open", "waiting_admin"] }
          });
          io2.to("admin_room").emit("new-ticket", {
            ticket,
            ticketId: ticket.ticketId,
            subject: ticket.subject,
            customerName: req.user?.name,
            pendingTicketsCount
          });
          io2.to("admin_room").emit("badge-update", {
            pendingTicketsCount
          });
          io2.to("admin_room").emit("ticket:created", {
            ticket,
            ticketId: ticket.ticketId,
            subject: ticket.subject,
            customerName: req.user?.name,
            pendingTicketsCount
          });
          io2.to("admin_room").emit("ticket:message", {
            ticketId: ticket.ticketId,
            ticketDbId: ticket._id,
            message: firstMessage
          });
        }
      } catch (secondaryErr) {
        console.error("Non-critical secondary task error on ticket creation:", secondaryErr);
      }
    })();
    res.status(201).json({ success: true, ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router8.get("/my-tickets", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const tickets = await SupportTicket.find({ user: req.user._id }).sort({ updatedAt: -1 });
    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router8.get("/all", protect, isAdmin, async (req, res) => {
  try {
    const { status, priority, category, search } = req.query;
    let filter = {};
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;
    if (search && typeof search === "string" && search.trim()) {
      const q = search.trim();
      filter.$or = [
        { ticketId: { $regex: q, $options: "i" } },
        { subject: { $regex: q, $options: "i" } },
        { customerName: { $regex: q, $options: "i" } },
        { customerEmail: { $regex: q, $options: "i" } },
        { orderNumber: { $regex: q, $options: "i" } }
      ];
    }
    const tickets = await SupportTicket.find(filter).populate("user", "name email phone avatar").sort({ updatedAt: -1 });
    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router8.get("/:id", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const ticket = await SupportTicket.findById(req.params.id).populate("user", "name email phone avatar");
    if (!ticket) return res.status(404).json({ success: false, message: "Support ticket not found" });
    if (req.user.role !== "admin" && ticket.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    res.json({ success: true, ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router8.post("/:id/reply", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const { message, attachments } = req.body;
    const messageContent = message || req.body.text;
    if (!messageContent || !messageContent.trim()) {
      return res.status(400).json({ success: false, message: "Message content is required" });
    }
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: "Support ticket not found" });
    const now = /* @__PURE__ */ new Date();
    const formattedAttachments = Array.isArray(attachments) ? attachments : attachments ? [attachments] : [];
    const newMsg = {
      sender: req.user._id,
      senderName: req.user.name,
      senderEmail: req.user.email,
      senderRole: req.user.role,
      message: messageContent.trim(),
      text: messageContent.trim(),
      attachments: formattedAttachments,
      timestamp: now,
      createdAt: now,
      isRead: false
    };
    ticket.messages.push(newMsg);
    if (req.user.role === "admin") {
      ticket.status = "waiting_customer";
    } else {
      ticket.status = "waiting_admin";
    }
    await ticket.save();
    (async () => {
      try {
        if (req.user?.role === "admin") {
          await Notification.create({
            user: ticket.user,
            title: `\u{1F4AC} Reply on Ticket #${ticket.ticketId}`,
            message: `Admin replied: "${messageContent.trim().slice(0, 60)}..."`,
            type: "ticket",
            link: "/user/support"
          });
        } else {
          const admins = await User.find({ role: "admin" }).select("_id");
          for (const admin of admins) {
            await Notification.create({
              user: admin._id,
              title: `\u{1F4AC} Customer Reply on Ticket #${ticket.ticketId}`,
              message: `${req.user?.name} replied: "${messageContent.trim().slice(0, 60)}..."`,
              type: "ticket",
              link: "/admin/support"
            });
          }
        }
        const io2 = getIO();
        if (io2) {
          const payload = {
            ticketId: ticket.ticketId,
            ticketDbId: ticket._id,
            status: ticket.status,
            message: newMsg
          };
          io2.to(`ticket_${ticket._id}`).emit("ticket:message", payload);
          io2.to(`ticket_${ticket.ticketId}`).emit("ticket:message", payload);
          if (req.user?.role === "admin") {
            io2.to(`user_${ticket.user}`).emit("ticket:message", payload);
            io2.to(`user_${ticket.user}`).emit("notification:new", {
              title: "Ticket Reply",
              message: `Admin replied to #${ticket.ticketId}`
            });
          } else {
            io2.to("admin_room").emit("ticket:message", payload);
          }
        }
      } catch (secondaryErr) {
        console.error("Non-critical secondary task error on ticket reply:", secondaryErr);
      }
    })();
    res.json({ success: true, ticket, newMsg });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router8.patch("/:id/status", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const { status } = req.body;
    const validStatuses = ["open", "waiting_customer", "waiting_admin", "in_progress", "resolved", "closed", "reopened"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value" });
    }
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: "Support ticket not found" });
    if (req.user.role !== "admin" && ticket.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized to modify this ticket" });
    }
    ticket.status = status;
    await ticket.save();
    const io2 = getIO();
    if (io2) {
      const pendingTicketsCount = await SupportTicket.countDocuments({
        status: { $in: ["open", "waiting_admin"] }
      });
      const payload = { ticketId: ticket.ticketId, ticketDbId: ticket._id, status, pendingTicketsCount };
      io2.to(`ticket_${ticket._id}`).emit("ticket:status_change", payload);
      io2.to(`user_${ticket.user}`).emit("ticket:status_change", payload);
      io2.to("admin_room").emit("ticket:status_change", payload);
      io2.to("admin_room").emit("badge-update", { pendingTicketsCount });
    }
    res.json({ success: true, message: `Ticket status updated to ${status}`, ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router8.patch("/:id/priority", protect, isAdmin, async (req, res) => {
  try {
    const { priority } = req.body;
    if (!["low", "medium", "high", "urgent"].includes(priority)) {
      return res.status(400).json({ success: false, message: "Invalid priority" });
    }
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: "Support ticket not found" });
    ticket.priority = priority;
    await ticket.save();
    res.json({ success: true, message: `Priority updated to ${priority}`, ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router8.patch("/:id/assign", protect, isAdmin, async (req, res) => {
  try {
    const { staffName } = req.body;
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: "Support ticket not found" });
    ticket.assignedStaff = staffName || "Unassigned";
    await ticket.save();
    res.json({ success: true, message: "Assigned staff updated", ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router8.patch("/:id/notes", protect, isAdmin, async (req, res) => {
  try {
    const { internalNotes } = req.body;
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: "Support ticket not found" });
    ticket.internalNotes = internalNotes || "";
    await ticket.save();
    res.json({ success: true, message: "Internal notes saved", ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
var ticketRoutes_default = router8;

// src/routes/notificationRoutes.ts
import { Router as Router9 } from "express";
var router9 = Router9();
router9.get("/", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(30);
    const unreadCount = await Notification.countDocuments({ user: req.user._id, isRead: false });
    res.json({ success: true, notifications, unreadCount });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router9.put("/read-all", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });
    res.json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
var notificationRoutes_default = router9;

// src/routes/adminRoutes.ts
import { Router as Router10 } from "express";

// src/models/Settings.ts
import mongoose14, { Schema as Schema12 } from "mongoose";
var SettingsSchema = new Schema12(
  {
    siteName: { type: String, default: "SubAccess BD" },
    tagline: { type: String, default: "Digital Subscription Marketplace in Bangladesh" },
    bkashNumber: { type: String, default: "01700000000" },
    nagadNumber: { type: String, default: "01800000000" },
    rocketNumber: { type: String, default: "01900000000" },
    helplineEmail: { type: String, default: "support@subaccessbd.com" },
    helplinePhone: { type: String, default: "+8801700000000" },
    whatsappNumber: { type: String, default: "+8801700000000" },
    noticeBannerText: { type: String, default: "\u{1F389} Get 10% OFF on all Netflix & Canva Pro Subscriptions! Use Code: SUBBD10" },
    noticeActive: { type: Boolean, default: true },
    maintenanceMode: { type: Boolean, default: false }
  },
  {
    timestamps: true
  }
);
var Settings = mongoose14.model("Settings", SettingsSchema);

// src/routes/adminRoutes.ts
var router10 = Router10();
router10.use("/orders", orderRoutes_default);
router10.get("/analytics", protect, isAdmin, async (req, res) => {
  try {
    const pendingOrdersCount = await Order.countDocuments({ orderStatus: "pending" });
    const pendingPaymentsCount = await Payment.countDocuments({ status: "pending" });
    const pendingTicketsCount = await SupportTicket.countDocuments({ status: { $in: ["open", "waiting_admin"] } });
    const totalCustomersCount = await User.countDocuments({ role: "user" });
    const totalProductsCount = await Product.countDocuments({ isActive: true });
    const startOfToday = /* @__PURE__ */ new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayOrders = await Order.find({
      paymentStatus: "verified",
      createdAt: { $gte: startOfToday }
    });
    const todaysRevenueBDT = todayOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const startOfMonth = /* @__PURE__ */ new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthOrders = await Order.find({
      paymentStatus: "verified",
      createdAt: { $gte: startOfMonth }
    });
    const monthlyRevenueBDT = monthOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const allVerifiedOrders = await Order.find({ paymentStatus: "verified" });
    const totalRevenueBDT = allVerifiedOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const recentOrders = await Order.find().sort({ createdAt: -1 }).limit(10);
    const recentTransactions = await Payment.find().populate("user", "name email phone").populate("order", "orderNumber totalAmount paymentMethod transactionId senderPhone customerName").sort({ createdAt: -1 }).limit(10);
    const verificationQueue = await Payment.find({ status: "pending" }).populate("user", "name email phone").populate("order", "orderNumber totalAmount paymentMethod transactionId senderPhone customerName").sort({ createdAt: -1 }).limit(10);
    res.json({
      success: true,
      analytics: {
        pendingOrdersCount,
        pendingPaymentsCount,
        pendingTicketsCount,
        todaysRevenueBDT,
        monthlyRevenueBDT,
        totalRevenueBDT,
        totalCustomersCount,
        totalProductsCount
      },
      recentOrders,
      recentTransactions,
      verificationQueue
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router10.get("/activity-logs", protect, isAdmin, async (req, res) => {
  try {
    const logs = await ActivityLog.find().populate("user", "name email role").sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router10.get("/users", protect, isAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router10.patch("/users/:id/promote", protect, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    user.role = "admin";
    await user.save();
    await ActivityLog.create({
      user: req.user?._id,
      userName: req.user?.name,
      action: "User Promoted",
      details: `Promoted ${user.email} to Admin`
    });
    res.json({ success: true, message: `Promoted ${user.name} to Admin`, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router10.patch("/users/:id/demote", protect, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    user.role = "user";
    await user.save();
    await ActivityLog.create({
      user: req.user?._id,
      userName: req.user?.name,
      action: "User Demoted",
      details: `Demoted ${user.email} to User`
    });
    res.json({ success: true, message: `Demoted ${user.name} to User`, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router10.patch("/users/:id/toggle-block", protect, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    user.isBlocked = !user.isBlocked;
    await user.save();
    res.json({
      success: true,
      message: `User ${user.isBlocked ? "Blocked" : "Unblocked"}`,
      user
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router10.patch("/users/:id/reset-password", protect, isAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: `Password reset successfully for ${user.name}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router10.patch("/users/:id/verify-email", protect, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    user.isEmailVerified = true;
    await user.save();
    res.json({ success: true, message: `Email verified for ${user.name}`, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router10.delete("/users/:id", protect, isAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, message: "User account deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router10.put("/users/:id/role", protect, isAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!["user", "admin"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role specified" });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    user.role = role;
    await user.save();
    await ActivityLog.create({
      user: req.user?._id,
      userName: req.user?.name,
      action: "Role Changed",
      details: `Changed user ${user.email} role to ${role}`
    });
    res.json({ success: true, message: `User role updated to ${role}`, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router10.get("/settings", async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router10.put("/settings", protect, isAdmin, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings(req.body);
    } else {
      Object.assign(settings, req.body);
    }
    await settings.save();
    res.json({ success: true, message: "Settings updated successfully", settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
var adminRoutes_default = router10;

// src/routes/uploadRoutes.ts
import { Router as Router11 } from "express";
var router11 = Router11();
router11.post("/imgbb", async (req, res) => {
  try {
    const apiKey = process.env.IMGBB_API_KEY || process.env.VITE_IMGBB_API_KEY;
    if (!apiKey) {
      res.status(400).json({
        success: false,
        message: "ImgBB API Key is missing in environment configuration (IMGBB_API_KEY / VITE_IMGBB_API_KEY)."
      });
      return;
    }
    let imagePayload = req.body.image || req.body.file;
    if (!imagePayload) {
      res.status(400).json({
        success: false,
        message: "No image data provided in request body."
      });
      return;
    }
    const formData = new FormData();
    formData.append("image", imagePayload);
    const imgbbResponse = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey.trim()}`, {
      method: "POST",
      body: formData
    });
    const data = await imgbbResponse.json();
    if (data && data.success && data.data) {
      res.json({
        success: true,
        url: data.data.url,
        display_url: data.data.display_url || data.data.url,
        delete_url: data.data.delete_url || ""
      });
      return;
    }
    res.status(400).json({
      success: false,
      message: data.error?.message || "ImgBB upload rejected."
    });
  } catch (error) {
    console.error("ImgBB Upload Route Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error during ImgBB image upload."
    });
  }
});
var uploadRoutes_default = router11;

// src/routes/fastpay.routes.ts
import { Router as Router12 } from "express";

// src/utils/fastpay.ts
import crypto from "crypto";
var FastPay = class {
  apiKey;
  merchantId;
  baseUrl;
  webhookSecret;
  timeout;
  constructor(config = {}) {
    this.apiKey = config.apiKey || (typeof process !== "undefined" ? process.env.FASTPAY_API_KEY : "") || "";
    this.merchantId = config.merchantId || (typeof process !== "undefined" ? process.env.FASTPAY_MERCHANT_ID : "") || "";
    const rawBaseUrl = config.baseUrl || (typeof process !== "undefined" ? process.env.FASTPAY_API_URL : "") || "";
    this.webhookSecret = config.webhookSecret || (typeof process !== "undefined" ? process.env.FASTPAY_WEBHOOK_SECRET : "") || "";
    this.timeout = config.timeout || 1e4;
    if (!this.apiKey) throw new Error("FastPay SDK Error: API key is required.");
    if (!this.merchantId) throw new Error("FastPay SDK Error: Merchant ID is required.");
    if (!rawBaseUrl) throw new Error("FastPay SDK Error: API base URL is required.");
    this.baseUrl = rawBaseUrl.trim().replace(/\/+$/, "");
  }
  async _request(endpoint, method = "GET", data = null) {
    const url = `${this.baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
        "Authorization": `Bearer ${this.apiKey}`
      },
      body: data ? JSON.stringify(data) : void 0
    });
    const resText = await response.text();
    let json;
    try {
      json = JSON.parse(resText);
    } catch (_) {
      json = { message: resText };
    }
    if (!response.ok) {
      const err = new Error(json.message || "FastPay API Request Failed");
      err.status = response.status;
      err.code = json.code || "API_ERROR";
      throw err;
    }
    return json.data || json;
  }
  // 1. Create Hosted Checkout Session
  async createCheckout(params) {
    if (!params.orderId) throw new Error("FastPay SDK Error: orderId is required.");
    if (!params.amount || Number(params.amount) <= 0) throw new Error("FastPay SDK Error: valid positive amount is required.");
    if (!params.returnUrl || !/^https?:\/\//i.test(params.returnUrl)) throw new Error("FastPay SDK Error: valid returnUrl (HTTP/HTTPS) is required.");
    const res = await this._request("/checkout/sessions", "POST", {
      orderId: String(params.orderId).trim(),
      amount: Number(params.amount),
      currency: (params.currency || "BDT").toUpperCase(),
      returnUrl: params.returnUrl.trim(),
      cancelUrl: params.cancelUrl ? params.cancelUrl.trim() : "",
      customerName: params.customerName || "",
      customerPhone: params.customerPhone || ""
    });
    return {
      success: true,
      sessionId: res.sessionId,
      checkoutUrl: res.checkoutUrl,
      orderId: res.orderId,
      amount: res.amount,
      currency: res.currency,
      status: res.status,
      expiresAt: res.expiresAt
    };
  }
  // 2. Programmatically Verify Payment
  async verifyPayment(params) {
    if (!params.transactionId) throw new Error("FastPay SDK Error: transactionId is required.");
    if (!params.sessionId) throw new Error("FastPay SDK Error: sessionId is required.");
    const res = await this._request(`/checkout/sessions/${params.sessionId}/verify-payment`, "POST", {
      trxId: params.transactionId,
      transactionId: params.transactionId,
      sessionId: params.sessionId,
      provider: params.provider
    });
    const session = res.data?.session || res.session || res.data || res;
    const payment = res.data?.payment || res.payment || {};
    const trxId = payment.transactionId || payment.trxId || session.transactionId || session.trxId || params.transactionId;
    const provider = payment.provider || payment.gateway || session.provider || session.gateway || params.provider || "FastPay";
    return {
      success: true,
      status: session.status || payment.status || "VERIFIED",
      sessionId: session.sessionId || params.sessionId,
      transactionId: trxId,
      amount: Number(payment.amount || session.amount || 0),
      provider
    };
  }
  // 3. Query Payment Status
  async getPaymentStatus(params) {
    const sessionId = typeof params === "string" ? params : params?.sessionId;
    if (!sessionId) throw new Error("FastPay SDK Error: sessionId is required.");
    const res = await this._request(`/checkout/sessions/${sessionId}`, "GET");
    const session = res.data?.session || res.session || res.data || res;
    const payment = res.data?.payment || res.payment || session.payment || {};
    const trxId = session.transactionId || session.trxId || payment.transactionId || payment.trxId || "";
    const provider = session.provider || session.gateway || payment.provider || payment.gateway || "FastPay";
    return {
      success: true,
      sessionId: session.sessionId || sessionId,
      orderId: session.orderId,
      status: session.status || "PENDING",
      amount: Number(session.amount || payment.amount || 0),
      currency: session.currency || "BDT",
      transactionId: trxId,
      provider,
      expiresAt: session.expiresAt,
      raw: session
    };
  }
  // 4. Verify Webhook Signature (Buffer, String, Object)
  static verifyWebhookSignature(payload, signatureHeader, secret, toleranceInSeconds = 300) {
    if (!secret) throw new Error("FastPay SDK Error: FASTPAY_WEBHOOK_SECRET is required for webhook verification.");
    if (!signatureHeader || typeof signatureHeader !== "string") return false;
    let payloadString = "";
    if (Buffer.isBuffer(payload)) payloadString = payload.toString("utf8");
    else if (typeof payload === "string") payloadString = payload;
    else if (payload && typeof payload === "object") payloadString = JSON.stringify(payload);
    else return false;
    const parts = Object.fromEntries(
      signatureHeader.split(",").map((p) => {
        const idx = p.indexOf("=");
        return idx !== -1 ? [p.substring(0, idx).trim(), p.substring(idx + 1).trim()] : [];
      })
    );
    if (!parts.t || !parts.v1 || !/^[0-9a-fA-F]{64}$/.test(parts.v1)) return false;
    const timestampNum = parseInt(parts.t, 10);
    if (isNaN(timestampNum)) return false;
    if (toleranceInSeconds && Math.abs(Math.floor(Date.now() / 1e3) - timestampNum) > toleranceInSeconds) return false;
    const expectedSig = crypto.createHmac("sha256", secret).update(`${parts.t}.${payloadString}`).digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(parts.v1, "hex"), Buffer.from(expectedSig, "hex"));
    } catch (_) {
      return false;
    }
  }
};
var fastpay_default = FastPay;

// src/routes/fastpay.routes.ts
var router12 = Router12();
var getFastPayInstance = () => new fastpay_default();
router12.get("/test", async (_req, res) => {
  try {
    const fastpay = getFastPayInstance();
    try {
      await fastpay.getPaymentStatus("cs_test_health_probe");
    } catch (apiErr) {
      if (apiErr?.status && apiErr.status < 500) {
        return res.json({
          success: true,
          message: "Fast Pay connection successful",
          gatewayUrl: fastpay.baseUrl
        });
      }
      throw apiErr;
    }
    return res.json({
      success: true,
      message: "Fast Pay connection successful",
      gatewayUrl: fastpay.baseUrl
    });
  } catch (error) {
    const err = error;
    const status = err.status || 500;
    const message = err.message || "An unexpected error occurred connecting to Fast Pay";
    const code = err.code || "API_ERROR";
    return res.status(status).json({
      success: false,
      message,
      code
    });
  }
});
router12.post("/create-checkout", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, message: "orderId is required" });
    }
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (req.user.role !== "admin" && order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized to create checkout for this order" });
    }
    if (order.paymentStatus === "verified" || order.orderStatus === "completed") {
      return res.status(400).json({ success: false, message: "Order is already paid and verified" });
    }
    const amount = Number(order.totalAmount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid order amount" });
    }
    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5174").replace(/\/+$/, "");
    const returnUrl = `${frontendUrl}/user/orders`;
    const cancelUrl = `${frontendUrl}/checkout`;
    const fastpay = getFastPayInstance();
    const sessionResult = await fastpay.createCheckout({
      orderId: order._id.toString(),
      amount,
      currency: "BDT",
      customerName: order.customerName || req.user.name,
      customerPhone: order.customerPhone || req.user.phone || "",
      returnUrl,
      cancelUrl
    });
    order.fastpaySessionId = sessionResult.sessionId;
    order.paymentProvider = "FastPay";
    order.paymentMethod = "FastPay";
    await order.save();
    const checkoutHost = (process.env.FASTPAY_CHECKOUT_URL || "http://localhost:5173").replace(/\/+$/, "");
    const checkoutUrl = `${checkoutHost}/checkout/session/${sessionResult.sessionId}`;
    return res.json({
      success: true,
      sessionId: sessionResult.sessionId,
      checkoutUrl,
      orderId: order._id,
      amount: order.totalAmount
    });
  } catch (error) {
    const err = error;
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to create Fast Pay checkout session",
      code: err.code || "CHECKOUT_ERROR"
    });
  }
});
router12.post("/verify-payment", protect, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });
    const { sessionId, transactionId, orderId } = req.body;
    if (!sessionId && !orderId) {
      return res.status(400).json({ success: false, message: "sessionId or orderId is required" });
    }
    let order = sessionId ? await Order.findOne({ fastpaySessionId: sessionId }) : null;
    if (!order && orderId) {
      order = await Order.findById(orderId);
    }
    if (!order) {
      return res.status(404).json({ success: false, message: "Order associated with session not found" });
    }
    if (req.user.role !== "admin" && order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized to verify payment for this order" });
    }
    if (order.paymentStatus === "verified") {
      const existingPayment = await Payment.findOne({ order: order._id });
      return res.json({
        success: true,
        message: "Order payment is already verified",
        order,
        payment: existingPayment
      });
    }
    const fastpay = getFastPayInstance();
    const effectiveSessionId = sessionId || order.fastpaySessionId;
    if (!effectiveSessionId) {
      return res.status(400).json({ success: false, message: "No Fast Pay session associated with this order" });
    }
    let actualTrxId = "";
    let provider = "FastPay";
    if (transactionId) {
      const normalizedTrxId = String(transactionId).trim().toUpperCase();
      const duplicateTrxOrder = await Order.findOne({
        transactionId: normalizedTrxId,
        paymentStatus: "verified",
        _id: { $ne: order._id }
      });
      if (duplicateTrxOrder) {
        return res.status(400).json({
          success: false,
          message: "Transaction ID has already been used for another verified order"
        });
      }
      const verifyResult = await fastpay.verifyPayment({
        sessionId: effectiveSessionId,
        transactionId: normalizedTrxId
      });
      if (!verifyResult || !verifyResult.success) {
        return res.status(400).json({
          success: false,
          message: "Payment verification failed with Fast Pay gateway"
        });
      }
      actualTrxId = verifyResult.transactionId || normalizedTrxId;
      provider = verifyResult.provider || "FastPay";
    } else {
      const sessionStatus = await fastpay.getPaymentStatus(effectiveSessionId);
      if (sessionStatus.status !== "COMPLETED" && sessionStatus.status !== "VERIFIED") {
        return res.status(400).json({
          success: false,
          message: `Fast Pay checkout session status is '${sessionStatus.status}'. Payment is not yet completed.`
        });
      }
      actualTrxId = sessionStatus.transactionId || order.transactionId || "";
      provider = sessionStatus.provider || "FastPay";
    }
    order.transactionId = actualTrxId;
    order.paymentProvider = provider;
    order.paymentMethod = "FastPay";
    order.paymentStatus = "verified";
    order.orderStatus = "processing";
    order.deliveryStatus = "pending";
    await order.save();
    const payment = await Payment.findOneAndUpdate(
      { order: order._id },
      {
        order: order._id,
        user: order.user,
        paymentMethod: "FastPay",
        transactionId: actualTrxId,
        senderPhone: order.customerPhone || req.user.phone || "",
        amount: order.totalAmount,
        status: "verified",
        verifiedAt: /* @__PURE__ */ new Date()
      },
      { upsert: true, new: true }
    );
    (async () => {
      try {
        await ActivityLog.create({
          user: req.user?._id,
          userName: req.user?.name,
          action: "FastPay Payment Verified",
          details: `Fast Pay payment verified (TrxID ${actualTrxId}) for Order #${order.orderNumber} (\u09F3${order.totalAmount})`
        });
        await Notification.create({
          user: order.user,
          title: "\u{1F389} Payment Completed!",
          message: `Payment completed successfully for order #${order.orderNumber}. Please wait while our admin prepares your subscription credentials.`,
          type: "order",
          link: "/user/orders"
        });
        const io2 = getIO();
        if (io2) {
          const pendingOrdersCount = await Order.countDocuments({ orderStatus: "pending" });
          const pendingPaymentsCount = await Payment.countDocuments({ status: "pending" });
          const socketPayload = {
            paymentId: payment._id,
            orderId: order._id,
            orderNumber: order.orderNumber,
            status: "verified",
            paymentStatus: "verified",
            orderStatus: "processing",
            deliveryStatus: "pending",
            transactionId: actualTrxId,
            pendingOrdersCount,
            pendingPaymentsCount
          };
          io2.to("admin_room").emit("payment-approved", socketPayload);
          io2.to("admin_room").emit("dashboard-update", socketPayload);
          io2.to(`user_${order.user}`).emit("payment-approved", socketPayload);
          io2.to(`user_${order.user}`).emit("order:updated", {
            orderId: order._id,
            orderNumber: order.orderNumber,
            status: "processing",
            paymentStatus: "verified",
            deliveryStatus: "pending",
            transactionId: actualTrxId
          });
        }
      } catch (secErr) {
        console.error("Secondary error during Fast Pay verification:", secErr);
      }
    })();
    return res.json({
      success: true,
      message: "Payment completed successfully. Please wait while our admin prepares your subscription credentials.",
      order,
      payment
    });
  } catch (error) {
    const err = error;
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Payment verification failed",
      code: err.code || "VERIFY_ERROR"
    });
  }
});
router12.get("/sync-session/:sessionId", protect, async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: "Session ID is required" });
    }
    const order = await Order.findOne({ fastpaySessionId: sessionId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order associated with session not found" });
    }
    if (req.user && req.user.role !== "admin" && order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    if (order.paymentStatus === "verified") {
      const payment = await Payment.findOne({ order: order._id });
      return res.json({ success: true, verified: true, order, payment });
    }
    const fastpay = getFastPayInstance();
    const sessionStatus = await fastpay.getPaymentStatus(sessionId);
    if (sessionStatus.status === "COMPLETED" || sessionStatus.status === "VERIFIED") {
      const actualTrxId = sessionStatus.transactionId || order.transactionId || "";
      const provider = sessionStatus.provider || "FastPay";
      order.transactionId = actualTrxId;
      order.paymentProvider = provider;
      order.paymentMethod = "FastPay";
      order.paymentStatus = "verified";
      order.orderStatus = "processing";
      order.deliveryStatus = "pending";
      await order.save();
      const payment = await Payment.findOneAndUpdate(
        { order: order._id },
        {
          order: order._id,
          user: order.user,
          paymentMethod: "FastPay",
          transactionId: actualTrxId,
          senderPhone: order.customerPhone || "",
          amount: order.totalAmount,
          status: "verified",
          verifiedAt: /* @__PURE__ */ new Date()
        },
        { upsert: true, new: true }
      );
      const io2 = getIO();
      if (io2) {
        const socketPayload = {
          paymentId: payment._id,
          orderId: order._id,
          orderNumber: order.orderNumber,
          status: "verified",
          paymentStatus: "verified",
          orderStatus: "processing",
          deliveryStatus: "pending",
          transactionId: actualTrxId
        };
        io2.to("admin_room").emit("payment-approved", socketPayload);
        io2.to(`user_${order.user}`).emit("payment-approved", socketPayload);
        io2.to(`user_${order.user}`).emit("order:updated", socketPayload);
      }
      return res.json({ success: true, verified: true, order, payment });
    }
    return res.json({ success: true, verified: false, status: sessionStatus.status, order });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Session sync error" });
  }
});
router12.post("/webhook", async (req, res) => {
  try {
    const signatureHeader = req.headers["x-fastpay-signature"] || req.headers["x-signature"];
    if (!signatureHeader) {
      return res.status(401).json({ success: false, message: "Missing webhook signature header" });
    }
    const secret = process.env.FASTPAY_WEBHOOK_SECRET || "";
    if (!secret) {
      console.error("FASTPAY_WEBHOOK_SECRET is not configured on backend");
      return res.status(500).json({ success: false, message: "Server webhook configuration error" });
    }
    const rawBodyBuffer = req.rawBody || req.body;
    const isValid = fastpay_default.verifyWebhookSignature(rawBodyBuffer, signatureHeader, secret);
    if (!isValid) {
      return res.status(401).json({ success: false, message: "Invalid or expired webhook signature" });
    }
    let payload;
    try {
      if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
        payload = req.body;
      } else {
        const bodyStr = Buffer.isBuffer(rawBodyBuffer) ? rawBodyBuffer.toString("utf8") : typeof rawBodyBuffer === "string" ? rawBodyBuffer : JSON.stringify(rawBodyBuffer);
        payload = JSON.parse(bodyStr);
      }
    } catch (_) {
      return res.status(400).json({ success: false, message: "Invalid JSON payload format" });
    }
    const { event, data } = payload || {};
    if (event !== "payment.verified") {
      return res.status(200).json({
        success: true,
        message: `Webhook event '${event || "unknown"}' acknowledged without state changes`
      });
    }
    const sessionId = data?.sessionId || data?.checkoutSessionId || data?.session_id || data?.id;
    const orderId = data?.orderId || data?.order_id;
    const transactionId = data?.transactionId || data?.trxId || data?.transaction_id || data?.payment?.transactionId || data?.payment?.trxId || data?.payment?.transaction_id;
    const amount = Number(data?.amount || data?.payment?.amount);
    const provider = data?.provider || data?.gateway || data?.payment?.provider || data?.payment?.gateway || "FastPay";
    let order = null;
    if (sessionId) {
      order = await Order.findOne({ fastpaySessionId: sessionId });
    }
    if (!order && orderId) {
      order = await Order.findById(orderId);
    }
    if (!order && transactionId) {
      order = await Order.findOne({ transactionId: String(transactionId).trim().toUpperCase() });
    }
    if (!order) {
      return res.status(404).json({ success: false, message: "Order associated with webhook session not found" });
    }
    if (order.paymentStatus === "verified") {
      return res.status(200).json({
        success: true,
        message: "Webhook already processed (idempotent)",
        orderId: order._id
      });
    }
    if (!isNaN(amount) && amount > 0 && Math.abs(amount - order.totalAmount) > 0.01) {
      console.error(`Fast Pay Webhook Security Alert: Amount mismatch for order ${order._id}. Expected: ${order.totalAmount}, Received: ${amount}`);
      return res.status(400).json({
        success: false,
        message: "Verified payment amount does not match order total amount"
      });
    }
    const normalizedTrxId = transactionId ? String(transactionId).trim().toUpperCase() : "";
    if (normalizedTrxId) {
      const duplicateOrder = await Order.findOne({
        transactionId: normalizedTrxId,
        paymentStatus: "verified",
        _id: { $ne: order._id }
      });
      if (duplicateOrder) {
        return res.status(400).json({
          success: false,
          message: "Transaction ID is already associated with another verified order"
        });
      }
    }
    const finalTrxId = normalizedTrxId || order.transactionId || "";
    order.transactionId = finalTrxId;
    order.paymentProvider = provider || "FastPay";
    order.paymentMethod = "FastPay";
    order.paymentStatus = "verified";
    order.orderStatus = "processing";
    order.deliveryStatus = "pending";
    await order.save();
    const payment = await Payment.findOneAndUpdate(
      { order: order._id },
      {
        order: order._id,
        user: order.user,
        paymentMethod: "FastPay",
        transactionId: finalTrxId,
        senderPhone: order.customerPhone || "",
        amount: order.totalAmount,
        status: "verified",
        verifiedAt: /* @__PURE__ */ new Date()
      },
      { upsert: true, new: true }
    );
    (async () => {
      try {
        await ActivityLog.create({
          user: order.user,
          userName: order.customerName,
          action: "Fast Pay Payment Verified",
          details: `Fast Pay webhook verified payment (TrxID ${finalTrxId}) for Order #${order.orderNumber} (\u09F3${order.totalAmount})`
        });
        await Notification.create({
          user: order.user,
          title: "\u{1F389} Payment Completed!",
          message: `Payment completed successfully for order #${order.orderNumber}. Please wait while our admin prepares your subscription credentials.`,
          type: "order",
          link: "/user/orders"
        });
        const io2 = getIO();
        if (io2) {
          const pendingOrdersCount = await Order.countDocuments({ orderStatus: "pending" });
          const pendingPaymentsCount = await Payment.countDocuments({ status: "pending" });
          const socketPayload = {
            paymentId: payment._id,
            orderId: order._id,
            orderNumber: order.orderNumber,
            status: "verified",
            paymentStatus: "verified",
            orderStatus: "processing",
            deliveryStatus: "pending",
            transactionId: finalTrxId,
            pendingOrdersCount,
            pendingPaymentsCount
          };
          io2.to("admin_room").emit("payment-approved", socketPayload);
          io2.to("admin_room").emit("dashboard-update", socketPayload);
          io2.to(`user_${order.user}`).emit("payment-approved", socketPayload);
          io2.to(`user_${order.user}`).emit("order:updated", {
            orderId: order._id,
            orderNumber: order.orderNumber,
            status: "processing",
            paymentStatus: "verified",
            deliveryStatus: "pending",
            transactionId: finalTrxId
          });
        }
      } catch (secErr) {
        console.error("Secondary error during Fast Pay webhook processing:", secErr);
      }
    })();
    return res.status(200).json({
      success: true,
      message: "Fast Pay webhook processed successfully",
      orderId: order._id
    });
  } catch (error) {
    const err = error;
    console.error("Fast Pay Webhook Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error processing Fast Pay webhook"
    });
  }
});
var fastpay_routes_default = router12;

// src/server.ts
dotenv.config();
var PORT = process.env.PORT || 5001;
async function startServer() {
  const app = express();
  app.set("trust proxy", 1);
  const server = http.createServer(app);
  initSocket(server);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5174",
    credentials: true
  }));
  app.use(
    express.json({
      limit: "10mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1e3,
    max: 500,
    message: { success: false, message: "Too many requests, please try again later." },
    validate: { xForwardedForHeader: false, default: false }
  });
  app.use("/api", apiLimiter);
  const dbConnected = await connectDB();
  if (dbConnected) {
    try {
      await seedDatabase();
    } catch (err) {
      console.error("Seed error:", err);
    }
  }
  app.use("/api/fastpay", fastpay_routes_default);
  app.use("/api/auth", authRoutes_default);
  app.use("/api/products", productRoutes_default);
  app.use("/api/categories", categoryRoutes_default);
  app.use("/api/orders", orderRoutes_default);
  app.use("/api/payments", paymentRoutes_default);
  app.use("/api/coupons", couponRoutes_default);
  app.use("/api/reviews", reviewRoutes_default);
  app.use("/api/tickets", ticketRoutes_default);
  app.use("/api/notifications", notificationRoutes_default);
  app.use("/api/admin", adminRoutes_default);
  app.use("/api/upload", uploadRoutes_default);
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      service: "SubAccess BD API",
      timestamp: /* @__PURE__ */ new Date()
    });
  });
  app.use(errorHandler);
  server.listen(PORT, () => {
    console.log(`\u{1F680} SubAccess BD Backend Server running on port ${PORT}`);
  });
}
async function seedDatabase() {
  const settingsCount = await Settings.countDocuments();
  if (settingsCount === 0) {
    await Settings.create({
      siteName: "SubAccess BD",
      tagline: "Professional Digital Subscription Marketplace in Bangladesh",
      bkashNumber: "01712345678",
      nagadNumber: "01812345678",
      rocketNumber: "01912345678",
      helplineEmail: "support@subaccessbd.com",
      helplinePhone: "+8801712345678",
      noticeBannerText: "\u{1F389} Flash Sale: Get 10% OFF on all Netflix & Canva Pro Subscriptions! Use Code: SUBBD10"
    });
  }
  const adminEmail = (process.env.ADMIN_INITIAL_EMAIL || "admin@subaccessbd.com").toLowerCase();
  const existingAdmin = await User.findOne({ email: adminEmail });
  if (!existingAdmin) {
    await User.create({
      name: "SubAccess Admin",
      email: adminEmail,
      password: process.env.ADMIN_INITIAL_PASSWORD || "AdminPassword123!",
      role: "admin",
      isEmailVerified: true,
      phone: "01712345678"
    });
    console.log(`\u{1F464} Seeded Default Super Admin: ${adminEmail}`);
  }
  const catCount = await Category.countDocuments();
  if (catCount === 0) {
    await Category.create({
      name: "Entertainment & Streaming",
      slug: "entertainment",
      description: "Netflix, Prime Video, Spotify Premium, YouTube Premium",
      icon: "Tv",
      isFeatured: true
    });
    await Category.create({
      name: "Productivity & Design",
      slug: "productivity-design",
      description: "Canva Pro, Figma Pro, Adobe Creative Cloud, MS 365",
      icon: "Palette",
      isFeatured: true
    });
    await Category.create({
      name: "AI & Developer Tools",
      slug: "ai-developer-tools",
      description: "ChatGPT Plus, JetBrains All Products, Claude Pro",
      icon: "Cpu",
      isFeatured: true
    });
    await Category.create({
      name: "Education & Learning",
      slug: "education-learning",
      description: "Coursera Plus, LinkedIn Learning, Skillshare",
      icon: "GraduationCap",
      isFeatured: true
    });
  }
  const couponCount = await Coupon.countDocuments();
  if (couponCount === 0) {
    await Coupon.create({
      code: "SUBBD10",
      discountPercentage: 10,
      maxDiscountBDT: 500,
      minSpendBDT: 200,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1e3),
      isActive: true
    });
  }
}
startServer();
//# sourceMappingURL=server.js.map
