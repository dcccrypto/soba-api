import cors from 'cors';
import { HEROKU_CONFIG } from '../config/heroku.js';

const isDevelopment = process.env.NODE_ENV !== 'production';

export const corsConfig = cors({
  origin: isDevelopment 
    ? true  // Allow all origins in development
    : HEROKU_CONFIG.CORS_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
  credentials: true,
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 200
});