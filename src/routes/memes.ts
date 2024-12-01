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

// In-memory storage for memes (replace with database in production)
let memes: Array<{
  id: string;
  url: string;
  pathname: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadDate: string;
}> = [];

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    console.log('Received file:', { 
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size 
    });

    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Upload endpoint
router.post('/upload', upload.single('meme'), async (req: Request, res: Response) => {
  console.log('Upload request received');
  
  try {
    if (!req.file) {
      console.log('No file in request');
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const file = req.file;
    console.log('Processing file:', { 
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size 
    });

    const fileExtension = file.originalname.split('.').pop();
    const filename = `${uuidv4()}.${fileExtension}`;

    console.log('Uploading to Vercel Blob:', filename);

    // Upload to Vercel Blob Storage
    const blob = await put(filename, file.buffer, {
      access: 'public',
      contentType: file.mimetype,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    console.log('Upload successful:', { 
      url: blob.url,
      pathname: blob.pathname
    });

    // Create meme record
    const meme = {
      id: uuidv4(),
      url: blob.url,
      pathname: blob.pathname,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      uploadDate: new Date().toISOString()
    };

    // Store meme in memory (replace with database in production)
    memes.unshift(meme);

    return res.status(200).json({
      success: true,
      data: {
        url: blob.url,
        pathname: blob.pathname
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
  console.log('Fetching memes');
  
  try {
    return res.status(200).json({
      success: true,
      data: memes
    });
  } catch (error) {
    console.error('Error fetching memes:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Error fetching memes'
    });
  }
});

export default router;
