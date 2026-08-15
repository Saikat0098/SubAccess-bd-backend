import { Router, Request, Response } from 'express';
import { protect, isAdmin } from '../middleware/auth.js';

const router = Router();

// Handle ImgBB Upload Proxy
router.post('/imgbb', async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.IMGBB_API_KEY || process.env.VITE_IMGBB_API_KEY;

    if (!apiKey) {
      res.status(400).json({
        success: false,
        message: 'ImgBB API Key is missing in environment configuration (IMGBB_API_KEY / VITE_IMGBB_API_KEY).',
      });
      return;
    }

    let imagePayload = req.body.image || req.body.file;

    if (!imagePayload) {
      res.status(400).json({
        success: false,
        message: 'No image data provided in request body.',
      });
      return;
    }

    // Prepare FormData for ImgBB API
    const formData = new FormData();
    formData.append('image', imagePayload);

    const imgbbResponse = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey.trim()}`, {
      method: 'POST',
      body: formData,
    });

    const data = await imgbbResponse.json();

    if (data && data.success && data.data) {
      res.json({
        success: true,
        url: data.data.url,
        display_url: data.data.display_url || data.data.url,
        delete_url: data.data.delete_url || '',
      });
      return;
    }

    res.status(400).json({
      success: false,
      message: data.error?.message || 'ImgBB upload rejected.',
    });
  } catch (error: any) {
    console.error('ImgBB Upload Route Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during ImgBB image upload.',
    });
  }
});

export default router;
