import cors from 'cors';
import { herokuConfig } from '../config/heroku.js';

const isDevelopment = process.env.NODE_ENV !== 'production';

export const corsConfig = cors({
  origin: isDevelopment 
    ? true  // Allow all origins in development
    : herokuConfig.corsOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
  credentials: true,
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 200
});