import express, { Request, Response } from 'express';
import multer from 'multer';
import { put } from '@vercel/blob';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 4.5 * 1024 * 1024, // 4.5MB limit (Vercel Blob server upload limit)
  },
  fileFilter: (req, file, cb) => {
    // Accept images and GIFs
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Upload endpoint
router.post('/upload', upload.single('meme'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const file = req.file;
    const fileExtension = file.originalname.split('.').pop();
    const filename = `${uuidv4()}.${fileExtension}`;

    // Upload to Vercel Blob Storage
    const blob = await put(filename, file.buffer, {
      access: 'public',
      contentType: file.mimetype,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return res.status(200).json({
      success: true,
      data: {
        id: uuidv4(),
        filename: blob.pathname,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        uploadDate: new Date().toISOString(),
        url: blob.url
      }
    });

  } catch (error) {
    console.error('Error uploading file:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Error uploading file'
    });
  }
});

// Get all memes endpoint
router.get('/', async (req: Request, res: Response) => {
  try {
    // In a real application, you would fetch the list of memes from a database
    // For now, we'll return a success message
    res.json({
      success: true,
      message: 'Memes endpoint working',
      data: [] // You'll want to populate this with actual meme data
    });
  } catch (error) {
    console.error('Error fetching memes:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Error fetching memes'
    });
  }
});

export default router;
