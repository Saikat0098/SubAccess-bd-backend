import { Router, Request, Response } from 'express';
import { Category } from '../models/Category.js';
import { protect, isAdmin } from '../middleware/auth.js';

const router = Router();

// @route GET /api/categories
router.get('/', async (req: Request, res: Response) => {
  try {
    const categories = await Category.find().sort({ name: 1 });
    res.json({ success: true, categories });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route POST /api/categories (Admin)
router.post('/', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    const { name, description, icon, isFeatured } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });

    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');

    const category = await Category.create({
      name,
      slug,
      description: description || '',
      icon: icon || 'Sparkles',
      isFeatured: isFeatured !== undefined ? isFeatured : true,
    });

    res.status(201).json({ success: true, category });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route DELETE /api/categories/:id (Admin)
router.delete('/:id', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Category removed' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
