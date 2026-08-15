import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Review } from '../models/Review.js';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { protect, isAdmin, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Helper function to recalculate and persist average rating and total review count in MongoDB Product
const updateProductRatingStats = async (productId: string) => {
  try {
    const objId = new mongoose.Types.ObjectId(productId);
    const stats = await Review.aggregate([
      { $match: { product: objId, isApproved: true, isHidden: { $ne: true } } },
      {
        $group: {
          _id: '$product',
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
        },
      },
    ]);

    if (stats.length > 0) {
      const avg = Math.round(stats[0].averageRating * 10) / 10;
      await Product.findByIdAndUpdate(productId, {
        averageRating: avg,
        totalReviews: stats[0].totalReviews,
      });
    } else {
      await Product.findByIdAndUpdate(productId, {
        averageRating: 5.0,
        totalReviews: 0,
      });
    }
  } catch (err) {
    console.error('Error updating product rating stats in MongoDB:', err);
  }
};

// @route GET /api/reviews
// @desc Get public reviews for a product with rating statistics and filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const { productId, sort = 'newest' } = req.query;

    let query: any = { isApproved: true, isHidden: { $ne: true } };
    if (productId) {
      query.product = productId;
    }

    let sortOptions: any = { createdAt: -1 };
    if (sort === 'rating_high') sortOptions = { rating: -1, createdAt: -1 };
    else if (sort === 'rating_low') sortOptions = { rating: 1, createdAt: -1 };
    else if (sort === 'helpful') sortOptions = { helpfulVotes: -1, createdAt: -1 };

    const reviews = await Review.find(query)
      .populate('user', 'name avatar')
      .populate('product', 'title image price')
      .sort(sortOptions);

    // Compute rating breakdown stats if productId is supplied
    let stats = {
      averageRating: 5.0,
      totalReviews: reviews.length,
      ratingCounts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } as Record<number, number>,
    };

    if (productId) {
      const counts: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      let sum = 0;

      reviews.forEach((r) => {
        const rRating = Math.min(5, Math.max(1, Math.round(r.rating)));
        counts[rRating] = (counts[rRating] || 0) + 1;
        sum += r.rating;
      });

      stats = {
        averageRating: reviews.length > 0 ? Math.round((sum / reviews.length) * 10) / 10 : 5.0,
        totalReviews: reviews.length,
        ratingCounts: counts,
      };
    }

    res.json({ success: true, reviews, stats });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route GET /api/reviews/eligibility
// @desc Check if logged-in user has a COMPLETED order for a product and whether they already reviewed it
router.get('/eligibility', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const { productId } = req.query;
    if (!productId) {
      return res.status(400).json({ success: false, message: 'Product ID is required' });
    }

    // Query MongoDB Atlas for a completed order containing this product for this user
    const completedOrder = await Order.findOne({
      user: req.user._id,
      orderStatus: 'completed',
      'items.product': productId,
    }).sort({ createdAt: -1 });

    if (!completedOrder) {
      return res.json({
        success: true,
        canReview: false,
        hasReviewed: false,
        message: 'Only verified purchasers with a COMPLETED order for this product can write a review.',
      });
    }

    // Check if the user already submitted a review for this product
    const existingReview = await Review.findOne({
      user: req.user._id,
      product: productId,
    });

    if (existingReview) {
      return res.json({
        success: true,
        canReview: true,
        hasReviewed: true,
        existingReview,
        orderId: completedOrder._id,
        orderNumber: completedOrder.orderNumber,
        message: 'You have already reviewed this purchase. You can edit your review.',
      });
    }

    return res.json({
      success: true,
      canReview: true,
      hasReviewed: false,
      orderId: completedOrder._id,
      orderNumber: completedOrder.orderNumber,
      message: 'Verified Purchase Confirmed! You are eligible to submit a review.',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route POST /api/reviews
// @desc Submit a new review (Enforces COMPLETED order check in MongoDB)
router.post('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const { product, rating, title, comment, images } = req.body;

    if (!product || !rating || !title || !comment) {
      return res.status(400).json({
        success: false,
        message: 'Product ID, rating (1-5), review title, and review description are required.',
      });
    }

    const numRating = Number(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be a number between 1 and 5.' });
    }

    // 1. STRICT BACKEND MongoDB CHECK: Must have a completed order for this product
    const completedOrder = await Order.findOne({
      user: req.user._id,
      orderStatus: 'completed',
      'items.product': product,
    }).sort({ createdAt: -1 });

    if (!completedOrder) {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: You can only review products from completed orders. Unverified or pending purchases cannot submit reviews.',
      });
    }

    // 2. CHECK REVIEW LIMIT: Only 1 review per user/product
    const existingReview = await Review.findOne({
      user: req.user._id,
      product,
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted a review for this product. You can update your existing review.',
      });
    }

    // Create review in MongoDB
    const review = await Review.create({
      user: req.user._id,
      userName: req.user.name,
      userAvatar: req.user.avatar || '',
      product,
      order: completedOrder._id,
      rating: numRating,
      title: title.trim(),
      comment: comment.trim(),
      images: Array.isArray(images) ? images : [],
      isVerifiedPurchase: true,
      isApproved: true,
      isHidden: false,
    });

    // Recalculate product rating stats in MongoDB
    await updateProductRatingStats(product.toString());

    // Create activity log
    await ActivityLog.create({
      user: req.user._id,
      userName: req.user.name,
      action: 'Submitted Review',
      details: `Submitted a ${numRating}-star verified purchase review for Product ID ${product}`,
    });

    res.status(201).json({
      success: true,
      message: 'Thank you! Your verified purchase review has been submitted.',
      review,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PUT /api/reviews/:id
// @desc Update existing review
router.put('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const { rating, title, comment, images } = req.body;
    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    // Verify ownership or admin
    if (review.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this review' });
    }

    if (rating !== undefined) review.rating = Number(rating);
    if (title !== undefined) review.title = title.trim();
    if (comment !== undefined) review.comment = comment.trim();
    if (images !== undefined) review.images = Array.isArray(images) ? images : [];

    await review.save();

    await updateProductRatingStats(review.product.toString());

    res.json({ success: true, message: 'Review updated successfully', review });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route POST /api/reviews/:id/helpful
// @desc Toggle helpful vote on a review
router.post('/:id/helpful', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });

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
      hasVoted: !hasVoted,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route GET /api/reviews/admin/all (Admin)
// @desc Get all reviews for admin moderation with search & filtering
router.get('/admin/all', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    const { search, filter } = req.query;

    let queryFilter: any = {};

    if (filter === 'hidden') queryFilter.isHidden = true;
    else if (filter === 'featured') queryFilter.isFeatured = true;

    if (search) {
      const searchRegex = new RegExp(search as string, 'i');
      queryFilter.$or = [
        { userName: searchRegex },
        { title: searchRegex },
        { comment: searchRegex },
      ];
    }

    const reviews = await Review.find(queryFilter)
      .populate('user', 'name email avatar')
      .populate('product', 'title image price')
      .populate('order', 'orderNumber orderStatus')
      .sort({ createdAt: -1 });

    res.json({ success: true, reviews });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PATCH /api/reviews/:id/toggle-hide (Admin)
router.patch('/:id/toggle-hide', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });

    review.isHidden = !review.isHidden;
    await review.save();

    await updateProductRatingStats(review.product.toString());

    res.json({
      success: true,
      message: review.isHidden ? 'Review hidden from store' : 'Review unhidden',
      isHidden: review.isHidden,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PATCH /api/reviews/:id/toggle-feature (Admin)
router.patch('/:id/toggle-feature', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });

    review.isFeatured = !review.isFeatured;
    await review.save();

    res.json({
      success: true,
      message: review.isFeatured ? 'Review featured' : 'Review unfeatured',
      isFeatured: review.isFeatured,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route DELETE /api/reviews/:id (Admin or Owner)
router.delete('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });

    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });

    if (req.user.role !== 'admin' && review.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this review' });
    }

    const productId = review.product.toString();
    await Review.findByIdAndDelete(req.params.id);

    await updateProductRatingStats(productId);

    res.json({ success: true, message: 'Review deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
