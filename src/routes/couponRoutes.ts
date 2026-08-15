import { Router, Request, Response } from 'express';
import { Coupon } from '../models/Coupon.js';
import { protect, isAdmin } from '../middleware/auth.js';

const router = Router();

// @route POST /api/coupons/apply
router.post('/apply', async (req: Request, res: Response) => {
  try {
    const { code, cartTotal } = req.body;

    if (!code) return res.status(400).json({ success: false, message: 'Coupon code required' });

    const coupon = await Coupon.findOne({ code: code.toUpperCase().trim(), isActive: true });

    if (!coupon) {
      return res.status(400).json({ success: false, message: 'Invalid or inactive coupon code' });
    }

    if (coupon.expiresAt && new Date() > new Date(coupon.expiresAt)) {
      return res.status(400).json({ success: false, message: 'Coupon code has expired' });
    }

    const minSpend = coupon.minSpendBDT || (coupon as any).minOrderAmount || 0;
    if (minSpend && cartTotal < minSpend) {
      return res.status(400).json({ success: false, message: `Minimum cart total of ৳${minSpend} required for this coupon` });
    }

    let discount = 0;
    const isFixed = (coupon as any).discountType === 'fixed';
    if (isFixed) {
      discount = (coupon as any).discountValue || coupon.discountPercentage || 0;
    } else {
      const pct = (coupon as any).discountValue || coupon.discountPercentage || 0;
      discount = (cartTotal * pct) / 100;
      if (coupon.maxDiscountBDT && discount > coupon.maxDiscountBDT) {
        discount = coupon.maxDiscountBDT;
      }
    }

    if (discount > cartTotal) discount = cartTotal;

    res.json({
      success: true,
      message: `Coupon Applied! Saved ৳${Math.round(discount)}`,
      couponCode: coupon.code,
      discountAmount: Math.round(discount),
      discountPercentage: coupon.discountPercentage,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route GET /api/coupons (Admin)
router.get('/', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    res.json({ success: true, coupons });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route POST /api/coupons (Admin)
router.post('/', protect, isAdmin, async (req: Request, res: Response) => {
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
      usageLimit,
    } = req.body;

    if (!code) return res.status(400).json({ success: false, message: 'Coupon code is required' });

    const codeUpper = code.toUpperCase().trim();
    const existing = await Coupon.findOne({ code: codeUpper });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Coupon code already exists' });
    }

    const val = discountValue !== undefined ? Number(discountValue) : (discountPercentage !== undefined ? Number(discountPercentage) : 10);
    const type = discountType || 'percent';

    const coupon = await Coupon.create({
      code: codeUpper,
      discountPercentage: type === 'percent' ? val : 0,
      discountType: type,
      discountValue: val,
      minOrderAmount: minOrderAmount !== undefined ? Number(minOrderAmount) : (minSpendBDT !== undefined ? Number(minSpendBDT) : 0),
      minSpendBDT: minSpendBDT !== undefined ? Number(minSpendBDT) : (minOrderAmount !== undefined ? Number(minOrderAmount) : 0),
      maxDiscountBDT: maxDiscountBDT || 5000,
      expiresAt: expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      usageLimit: usageLimit || 1000,
      isActive: true,
    });

    res.status(201).json({ success: true, coupon });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PUT /api/coupons/:id (Admin)
router.put('/:id', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    res.json({ success: true, coupon });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PATCH /api/coupons/:id/toggle (Admin)
router.patch('/:id/toggle', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });

    coupon.isActive = !coupon.isActive;
    await coupon.save();

    res.json({ success: true, message: `Coupon ${coupon.isActive ? 'Activated' : 'Disabled'}`, coupon });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route DELETE /api/coupons/:id (Admin)
router.delete('/:id', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    await Coupon.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Coupon deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
