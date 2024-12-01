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

interface Meme {
  id: string;
  url: string;
  pathname: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadDate: string;
}

// File path for storing memes data
const MEMES_FILE = path.join(__dirname, '../../data/memes.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize memes file if it doesn't exist
if (!fs.existsSync(MEMES_FILE)) {
  fs.writeFileSync(MEMES_FILE, JSON.stringify([], null, 2));
}

// Load memes from file
const loadMemes = (): Meme[] => {
  try {
    const data = fs.readFileSync(MEMES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading memes:', error);
    return [];
  }
};

// Save memes to file
const saveMemes = (memes: Meme[]) => {
  try {
    fs.writeFileSync(MEMES_FILE, JSON.stringify(memes, null, 2));
  } catch (error) {
    console.error('Error saving memes:', error);
  }
};

// Load initial memes
let memes = loadMemes();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
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

    // Add to memory and save to file
    memes.unshift(meme);
    saveMemes(memes);

    console.log('Meme saved:', meme);

    return res.status(200).json({
      success: true,
      data: meme
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
    // Reload memes from file to ensure we have the latest
    memes = loadMemes();
    console.log('Returning memes:', memes);
    
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
