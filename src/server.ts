import express, { Request, Response, NextFunction } from 'express';
import { corsConfig } from './middleware/cors.js';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { TokenStats } from './types/index.js';
import fs from 'fs';
import NodeCache from 'node-cache';

// Configuration
const SOLANA_RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT || '';
const SOLANA_TRACKER_API_KEY = process.env.SOLANA_TRACKER_API_KEY || '';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || '';
const FOUNDER_WALLET = process.env.FOUNDER_WALLET || '';
const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Solana Tracker API client
const apiClient = axios.create({
  baseURL: 'https://data.solanatracker.io',
  headers: { 'x-api-key': SOLANA_TRACKER_API_KEY }
});

const statsCache = new NodeCache({ stdTTL: 60 }); // Cache for 1 minute

const app = express();
const port = process.env.PORT || 3001;

app.set('trust proxy', true); // Trust Heroku proxy
app.use(corsConfig);

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: process.env.NODE_ENV === 'production' ? 60 : 120, // 60 requests per minute in production, 120 in development
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    const ip = forwardedFor 
      ? (typeof forwardedFor === 'string' ? forwardedFor : forwardedFor[0])
      : req.ip;
    return ip || '127.0.0.1';
  }
});

app.use(limiter);

async function getTokenPrice(): Promise<number> {
  try {
    const response = await axios.get(
      `https://api.solanatracker.io/v1/token/${TOKEN_ADDRESS}/price`,
      {
        headers: {
          'x-api-key': SOLANA_TRACKER_API_KEY,
        },
      }
    );
    return response.data.price || 0;
  } catch (error) {
    console.error('Error fetching token price:', error);
    return 0;
  }
}

async function getTokenSupply(connection: Connection): Promise<number> {
  try {
    const tokenPubkey = new PublicKey(TOKEN_ADDRESS);
    const supply = await connection.getTokenSupply(tokenPubkey);
    return Number(supply.value.amount);
  } catch (error) {
    console.error('Error fetching token supply:', error);
    return 0;
  }
}

async function getFounderBalance(connection: Connection): Promise<number> {
  try {
    const tokenPubkey = new PublicKey(TOKEN_ADDRESS);
    const founderPubkey = new PublicKey(FOUNDER_WALLET);
    const balance = await connection.getTokenAccountBalance(founderPubkey);
    return Number(balance.value.amount);
  } catch (error) {
    console.error('Error fetching founder balance:', error);
    return 0;
  }
}

async function getHolderCount(): Promise<number> {
  try {
    const response = await axios.get(
      `https://api.helius.xyz/v0/token-metadata/${TOKEN_ADDRESS}?api-key=${HELIUS_API_KEY}`
    );
    return response.data.onChainMetadata?.holders || 0;
  } catch (error) {
    console.error('Error fetching holder count:', error);
    return 0;
  }
}

// Route handlers
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/token-stats', async (req: Request, res: Response) => {
  try {
    console.log('Fetching token stats...');
    
    // Check cache first
    const cachedStats = statsCache.get('tokenStats');
    if (cachedStats) {
      console.log('Returning cached stats:', cachedStats);
      const cacheAge = statsCache.getTtl('tokenStats');
      return res.json({
        ...cachedStats,
        cached: true,
        cacheAge: cacheAge ? Math.floor((cacheAge - Date.now()) / 1000) : null
      });
    }

    console.log('Cache miss, fetching fresh data...');
    console.log('Using RPC endpoint:', SOLANA_RPC_ENDPOINT);
    
    const connection = new Connection(SOLANA_RPC_ENDPOINT);
    
    console.log('Fetching token data...');
    const [price, totalSupply, founderBalance, holders] = await Promise.all([
      getTokenPrice().catch(e => {
        console.error('Price fetch error:', e);
        return 0;
      }),
      getTokenSupply(connection).catch(e => {
        console.error('Supply fetch error:', e);
        return 0;
      }),
      getFounderBalance(connection).catch(e => {
        console.error('Founder balance fetch error:', e);
        return 0;
      }),
      getHolderCount().catch(e => {
        console.error('Holder count fetch error:', e);
        return 0;
      })
    ]);

    console.log('Data fetched:', { price, totalSupply, founderBalance, holders });

    const stats = {
      price,
      totalSupply,
      founderBalance,
      holders,
      lastUpdated: new Date().toISOString()
    };

    // Cache the results
    statsCache.set('tokenStats', stats);
    console.log('Stats cached successfully');

    res.json(stats);
  } catch (error) {
    console.error('Error in /api/token-stats:', error);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    res.status(500).json({ 
      error: 'Failed to fetch token stats',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.options('*', corsConfig);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});