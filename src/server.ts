import express, { Request, Response, NextFunction } from 'express';
import { corsConfig } from './middleware/cors.js';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { TokenStats } from './types/index.js';

const app = express();
const port = process.env.PORT || 3001;

// Trust proxy - required for Heroku
app.set('trust proxy', 1);

// Apply CORS before other middleware
app.use(corsConfig);

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.headers['x-forwarded-for'] as string || '127.0.0.1';
  }
});

app.use(limiter);

// Cache for token stats
let tokenStatsCache = {
  data: null as TokenStats | null,
  timestamp: 0,
  ttl: 60 * 1000 // 1 minute cache
};

// Main stats endpoint - support both paths for backward compatibility
app.get(['/api/stats', '/api/token-stats'], async (req: Request, res: Response) => {
  try {
    // Check cache
    const now = Date.now();
    if (tokenStatsCache.data && now - tokenStatsCache.timestamp < tokenStatsCache.ttl) {
      console.log('[Cache] Returning cached data');
      return res.json({
        ...tokenStatsCache.data,
        cached: true,
        cacheAge: Math.floor((now - tokenStatsCache.timestamp) / 1000)
      });
    }

    console.log('[API] Fetching fresh token stats...');
    
    // Your token stats fetching logic here
    const tokenStats: TokenStats = {
      price: 0, // Replace with actual price fetch
      totalSupply: 0, // Replace with actual supply fetch
      founderBalance: 0, // Replace with actual balance fetch
      holders: 0, // Replace with actual holders count
      lastUpdated: new Date().toISOString()
    };

    // Update cache
    tokenStatsCache = {
      data: tokenStats,
      timestamp: now,
      ttl: 60 * 1000
    };

    console.log('[API] Data fetched successfully:', tokenStats);
    res.json(tokenStats);
  } catch (error) {
    console.error('[Error] Error fetching token stats:', error);
    res.status(500).json({ error: 'Failed to fetch token stats' });
  }
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[Error]', err.stack);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal Server Error' 
      : err.message
  });
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Add CORS preflight handling
app.options('*', corsConfig);

app.listen(port, () => {
  console.log(`[Server] Running on port ${port}`);
}); 