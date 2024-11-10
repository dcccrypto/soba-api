import express, { Request, Response, NextFunction } from 'express';
import { corsConfig } from './middleware/cors.js';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { Options } from 'express-rate-limit';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

// Interfaces
interface CacheData {
  price: number;
  totalSupply: number;
  founderBalance: number;
  holders: number;
  lastUpdated: string;
}

interface Cache {
  data: CacheData | null;
  timestamp: number;
  TTL: number;
}

// Setup
const app = express();
const port = process.env.PORT || 3001;
const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const connection = new Connection(HELIUS_URL);

// Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

app.set('trust proxy', 1);
app.use(corsConfig);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Cache setup
const cache: Cache = {
  data: null,
  timestamp: 0,
  TTL: 30000 // 30 seconds
};

// Solana Tracker client
const apiClient = axios.create({
  baseURL: 'https://data.solanatracker.io',
  headers: {
    'x-api-key': process.env.SOLANA_TRACKER_API_KEY,
  },
});

// Functions
async function getTokenPrice(tokenAddress: string): Promise<number> {
  try {
    const response = await apiClient.get('/price', {
      params: { token: tokenAddress }
    });
    return response.data.price || 0;
  } catch (error) {
    console.error('[API] Error fetching token price:', error);
    return 0;
  }
}

async function fetchTokenHoldersFromHelius(tokenAddress: string): Promise<number> {
  try {
    console.log('[API] Fetching token holders from Helius...');
    let page = 1;
    const uniqueOwners = new Set<string>();

    while (true) {
      // 1 request per second rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

      const response = await fetch(HELIUS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'getTokenAccounts',
          id: 'helius-holders',
          params: {
            page: page,
            limit: 1000,
            mint: tokenAddress,
          },
        }),
      });

      const data = await response.json();

      if (!data.result?.token_accounts || data.result.token_accounts.length === 0) {
        break;
      }

      data.result.token_accounts.forEach((account: any) => 
        uniqueOwners.add(account.owner)
      );

      page++;
    }

    return uniqueOwners.size;
  } catch (error) {
    console.error('[API] Error fetching token holders from Helius:', error);
    throw error;
  }
}

// Endpoints
app.get('/api/token-stats', async (_req: Request, res: Response) => {
  console.log('[API] Received token stats request');
  try {
    const now = Date.now();
    if (cache.data && (now - cache.timestamp) < cache.TTL) {
      console.log('[Cache] Returning cached data');
      res.json({
        ...cache.data,
        cached: true,
        cacheAge: now - cache.timestamp
      });
      return;
    }

    console.log('[Cache] Cache miss, fetching fresh data');
    const tokenAddress = process.env.TOKEN_ADDRESS;
    const founderAddress = process.env.FOUNDER_ADDRESS;

    if (!tokenAddress || !founderAddress) {
      throw new Error('Missing required environment variables');
    }

    const [tokenSupply, founderAccount, holdersCount, price] = await Promise.all([
      connection.getTokenSupply(new PublicKey(tokenAddress)),
      connection.getParsedTokenAccountsByOwner(new PublicKey(founderAddress), {
        mint: new PublicKey(tokenAddress)
      }),
      fetchTokenHoldersFromHelius(tokenAddress),
      getTokenPrice(tokenAddress)
    ]);

    const founderBalance = founderAccount.value[0]?.account.data.parsed.info.tokenAmount.uiAmount || 0;

    const responseData: CacheData = {
      price,
      totalSupply: tokenSupply.value.uiAmount ?? 0,
      founderBalance,
      holders: holdersCount,
      lastUpdated: new Date().toISOString()
    };

    console.log('[API] Data fetched successfully:', responseData);
    
    cache.data = responseData;
    cache.timestamp = now;

    res.json({
      ...responseData,
      cached: false
    });
  } catch (error) {
    console.error('[API] Error:', error);
    if (cache.data) {
      res.json({
        ...cache.data,
        cached: true,
        error: 'Failed to fetch fresh data'
      });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch token stats' });
  }
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Error handling
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 