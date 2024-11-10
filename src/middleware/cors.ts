import cors from 'cors';

export const corsConfig = cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['https://bosabastard.com'],
  methods: ['GET'],
  credentials: true,
  maxAge: 86400, // 24 hours
}); 