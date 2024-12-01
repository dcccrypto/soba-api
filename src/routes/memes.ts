import express, { Request, Response } from 'express';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    const uploadDir = path.join(__dirname, '../../public/uploads/memes');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const uniqueFilename = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueFilename);
  }
});

// File filter function
const fileFilter = (req: Express.Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and GIF files are allowed.'));
  }
};

// Configure multer upload
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// Upload endpoint
router.post('/upload', upload.single('meme'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
        error: 'Please provide a file'
      });
    }

    // Return success response with file details
    res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        id: uuidv4(),
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        uploadDate: new Date().toISOString(),
        url: `/uploads/memes/${req.file.filename}`
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get all memes endpoint
router.get('/', (req: Request, res: Response) => {
  try {
    // TODO: Implement fetching memes from database
    res.status(200).json({
      success: true,
      message: 'Memes retrieved successfully',
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
