import cors from 'cors';
import { HEROKU_CONFIG } from '../config/heroku.js';

const isDevelopment = process.env.NODE_ENV !== 'production';

const allowedOrigins = [
  'https://soab18.vercel.app',
  'https://www.soab18.vercel.app',
  'https://gyevw.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001'
];

export const corsConfig = cors({
  origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      callback(null, true);
      return;
    }

    if (isDevelopment || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`[CORS] Blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Requested-With'],
  exposedHeaders: ['Access-Control-Allow-Origin'],
  credentials: true,
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 200,
  preflightContinue: false
});