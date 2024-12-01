import cors from 'cors';
import { HEROKU_CONFIG } from '../config/heroku.js';

const isDevelopment = process.env.NODE_ENV !== 'production';

const allowedOrigins = [
  'https://soab18.vercel.app',
  'https://www.soab18.vercel.app',
  'https://gyevw.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173'  // Add Vite default port
];

export const corsConfig = cors({
  origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    console.log('[CORS] Request from origin:', origin);
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log('[CORS] Allowing request with no origin');
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin) || isDevelopment) {
      console.log('[CORS] Origin allowed:', origin);
      return callback(null, true);
    }

    console.log('[CORS] Origin not allowed:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Origin',
    'Accept',
    'X-Requested-With',
    'Access-Control-Allow-Origin',
    'Access-Control-Allow-Methods',
    'Access-Control-Allow-Headers'
  ],
  exposedHeaders: ['Access-Control-Allow-Origin'],
  credentials: true,
  maxAge: 86400, // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 204
});