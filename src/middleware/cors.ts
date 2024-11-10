import cors from 'cors';

const allowedOrigins = [
  'https://bosa.wtf',
  'https://www.bosa.wtf',
  'http://localhost:3000',
  'http://localhost:3001',
  'https://bosa2.vercel.app'
];

export const corsConfig = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('Blocked origin:', origin); // Add logging for debugging
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'OPTIONS'],
  credentials: true,
  maxAge: 86400,
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma']
}); 