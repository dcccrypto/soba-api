import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// Configure multer for handling file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../public/uploads/memes');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueId = uuidv4();
    const extension = path.extname(file.originalname);
    cb(null, `${uniqueId}${extension}`);
  }
});

// File filter to only allow images
const fileFilter = (req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG and GIF files are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// POST endpoint for meme uploads
router.post('/upload', upload.single('meme'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Create meme record in database (you'll need to implement this)
    const meme = {
      id: uuidv4(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadDate: new Date(),
      url: `/uploads/memes/${req.file.filename}`
    };

    // Here you would save the meme record to your database
    // For now, we'll just return the meme object
    res.status(201).json({
      success: true,
      message: 'Meme uploaded successfully',
      data: meme
    });
  } catch (error) {
    console.error('Error uploading meme:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload meme',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET endpoint to retrieve memes
router.get('/', async (req, res) => {
  try {
    // Here you would fetch memes from your database
    // For now, we'll return a placeholder response
    res.json({
      success: true,
      data: []
    });
  } catch (error) {
    console.error('Error fetching memes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch memes',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
