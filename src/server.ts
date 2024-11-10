import express, { Request, Response, NextFunction } from 'express';
import { corsConfig } from './middleware/cors.js';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { TokenStats } from './types/index.js';

const app = express();
const port = process.env.PORT || 3001;

// Apply CORS before other middleware
app.use(corsConfig);

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60 // 60 requests per minute
});

app.use(limiter);

// Error handling middleware with proper types
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal Server Error' 
      : err.message
  });
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Main stats endpoint - support both paths for backward compatibility
app.get(['/api/stats', '/api/token-stats'], async (req: Request, res: Response) => {
  try {
    const tokenStats: TokenStats = {
      price: 0,
      totalSupply: 0,
      founderBalance: 0,
      holders: 0,
      lastUpdated: new Date().toISOString()
    };

    // Your existing token stats logic here
    // ... fetch price, supply, etc ...

    res.json(tokenStats);
  } catch (error) {
    console.error('Error fetching token stats:', error);
    res.status(500).json({ error: 'Failed to fetch token stats' });
  }
});

// Add CORS preflight handling
app.options('*', corsConfig);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 