import cors from 'cors';

const allowedOrigins = [
  'https://bosa.wtf',
  'https://www.bosa.wtf',
  'http://localhost:3000',
  'http://localhost:3001',
  'https://bosa2.vercel.app',
  'https://bosabastard.com',
  'https://www.bosabastard.com',
  'https://bosa2-git-main-khubair-nasirs-projects.vercel.app',
  'https://bosa2-khubair-nasirs-projects.vercel.app',
  'https://bosa2-2q0vfq5my-khubair-nasirs-projects.vercel.app',
  'https://bosa2-huyq6c5j9-khubair-nasirs-projects.vercel.app'
];

export const corsConfig = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      console.log('Blocked origin:', origin); // Add logging for debugging
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  maxAge: 86400,
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma']
}); 