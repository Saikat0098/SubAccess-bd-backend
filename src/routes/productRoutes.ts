import { Router, Request, Response } from 'express';
import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';
import { protect, isAdmin } from '../middleware/auth.js';

const router = Router();

// Helper to resolve category ID from either ObjectId or Slug
async function resolveCategoryId(categoryInput: string): Promise<string> {
  if (!categoryInput) throw new Error('Category is required');
  if (typeof categoryInput === 'string' && categoryInput.match(/^[0-9a-fA-F]{24}$/)) {
    return categoryInput;
  }
  const found = await Category.findOne({ slug: categoryInput });
  if (found) return found._id.toString();
  
  // If not found by slug, check if any category exists or create one on the fly
  let defaultCat = await Category.findOne();
  if (!defaultCat) {
    defaultCat = await Category.create({
      name: categoryInput,
      slug: categoryInput.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-'),
      description: 'General Category',
    });
  }
  return defaultCat._id.toString();
}

// @route GET /api/products
router.get('/', async (req: Request, res: Response) => {
  try {
    const { category, search, popular, all } = req.query;
    let query: any = {};

    if (all !== 'true') {
      query.isActive = true;
    }

    if (category) {
      let catFilter: any = { slug: category };
      if (typeof category === 'string' && category.match(/^[0-9a-fA-F]{24}$/)) {
        catFilter = { $or: [{ _id: category }, { slug: category }] };
      }
      const foundCategory = await Category.findOne(catFilter);
      if (foundCategory) {
        query.category = foundCategory._id;
      }
    }

    if (search) {
      query.$or = [
        { title: { $regex: search as string, $options: 'i' } },
        { description: { $regex: search as string, $options: 'i' } },
      ];
    }

    if (popular === 'true') {
      query.isPopular = true;
    }

    const products = await Product.find(query).populate('category', 'name slug icon').sort({ createdAt: -1 });

    res.json({ success: true, products });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route GET /api/products/:idOrSlug
router.get('/:idOrSlug', async (req: Request, res: Response) => {
  try {
    const param = req.params.idOrSlug;
    let product;

    if (param.match(/^[0-9a-fA-F]{24}$/)) {
      product = await Product.findById(param).populate('category', 'name slug icon');
    } else {
      product = await Product.findOne({ slug: param }).populate('category', 'name slug icon');
    }

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.json({ success: true, product });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Helper for valid access types
const VALID_ACCESS_TYPES = ['credentials', 'invite_link', 'license_key', 'download_link'];

// @route POST /api/products (Admin)
router.post('/', protect, isAdmin, async (req: Request, res: Response) => {
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
      isActive,
    } = req.body;

    if (!title || !category || price === undefined) {
      return res.status(400).json({ success: false, message: 'Title, category, and price are required' });
    }

    const categoryId = await resolveCategoryId(category);
    const slug = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-') + '-' + Math.floor(1000 + Math.random() * 9000);

    const safeAccessType = VALID_ACCESS_TYPES.includes(accessType) ? accessType : 'credentials';

    const product = await Product.create({
      title,
      slug,
      category: categoryId,
      price: Number(price),
      discountPrice: discountPrice !== undefined ? Number(discountPrice) : 0,
      duration: duration || '1 Month',
      accessType: safeAccessType,
      description: description || title,
      features: Array.isArray(features) ? features : [],
      stockQuantity: stockQuantity !== undefined ? Number(stockQuantity) : 100,
      image: image || '',
      isPopular: !!isPopular,
      deliveryTimeText: deliveryTimeText || 'Instant Delivery (1-10 Mins)',
      isActive: isActive !== undefined ? !!isActive : true,
    });

    const populatedProduct = await Product.findById(product._id).populate('category', 'name slug icon');

    res.status(201).json({ success: true, product: populatedProduct });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PUT /api/products/:id (Admin)
router.put('/:id', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    const updateData = { ...req.body };

    if (updateData.category) {
      updateData.category = await resolveCategoryId(updateData.category);
    }

    if (updateData.accessType && !VALID_ACCESS_TYPES.includes(updateData.accessType)) {
      updateData.accessType = 'credentials';
    }

    if (updateData.price !== undefined) updateData.price = Number(updateData.price);
    if (updateData.discountPrice !== undefined) updateData.discountPrice = Number(updateData.discountPrice);
    if (updateData.stockQuantity !== undefined) updateData.stockQuantity = Number(updateData.stockQuantity);

    const product = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true }).populate('category', 'name slug icon');
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    res.json({ success: true, product });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route PATCH /api/products/:id/toggle-active (Admin)
router.patch('/:id/toggle-active', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    product.isActive = !product.isActive;
    await product.save();

    const populated = await Product.findById(product._id).populate('category', 'name slug icon');
    res.json({ success: true, message: `Product ${product.isActive ? 'Activated' : 'Hidden'}`, product: populated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route POST /api/products/:id/duplicate (Admin)
router.post('/:id/duplicate', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    const original = await Product.findById(req.params.id);
    if (!original) return res.status(404).json({ success: false, message: 'Original product not found' });

    const newTitle = `${original.title} (Copy)`;
    const newSlug = original.title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-') + '-copy-' + Math.floor(1000 + Math.random() * 9000);

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
      isPopular: false,
    });

    const populated = await Product.findById(duplicate._id).populate('category', 'name slug icon');
    res.status(201).json({ success: true, product: populated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route DELETE /api/products/:id (Admin)
router.delete('/:id', protect, isAdmin, async (req: Request, res: Response) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Product deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
