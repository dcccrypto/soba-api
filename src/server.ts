import express, { Request, Response, NextFunction } from 'express';
import { corsConfig } from './middleware/cors.js';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { TokenStats } from './types/index.js';

// Configuration
const SOLANA_RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
const SOLANA_TRACKER_API_KEY = '01221e00-46a1-42e1-b08d-d0541891b441';
const HELIUS_API_KEY = 'e568033d-06d6-49d1-ba90-b3564c91851b';
const TOKEN_ADDRESS = '25p2BoNp6qrJH5As6ek6H7Ei495oSkyZd3tGb97sqFmH';
const FOUNDER_WALLET = 'D2y4sbmBuSjLU1hfrZbBCaveCHjk952c9VsGwfxnNNNH';
const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Solana Tracker API client
const apiClient = axios.create({
  baseURL: 'https://data.solanatracker.io',
  headers: { 'x-api-key': SOLANA_TRACKER_API_KEY }
});

const app = express();
const port = process.env.PORT || 3001;

app.set('trust proxy', 1);
app.use(corsConfig);

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] as string || '127.0.0.1'
});

app.use(limiter);

// Token data fetching functions
async function getTokenPrice(): Promise<number> {
  try {
    const response = await apiClient.get('/price', {
      params: { token: TOKEN_ADDRESS }
    });
    return response.data.price || 0;
  } catch (error) {
    console.error('[Error] Fetching token price:', error);
    return 0;
  }
}

async function fetchTotalTokenSupply(): Promise<number> {
  try {
    const connection = new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
    const mintPublicKey = new PublicKey(TOKEN_ADDRESS);
    const supplyResponse = await connection.getTokenSupply(mintPublicKey);
    return supplyResponse.value.uiAmount || 0;
  } catch (error) {
    console.error('[Error] Fetching total supply:', error);
    return 0;
  }
}

async function fetchFounderBalance(): Promise<number> {
  try {
    const connection = new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
    const walletPublicKey = new PublicKey(FOUNDER_WALLET);
    const tokenAccounts = await connection.getTokenAccountsByOwner(walletPublicKey, {
      mint: new PublicKey(TOKEN_ADDRESS)
    });

    let totalBalance = 0;
    for (const account of tokenAccounts.value) {
      const accountInfo = await connection.getParsedAccountInfo(account.pubkey);
      if (accountInfo.value && 'parsed' in accountInfo.value.data) {
        const tokenAmount = accountInfo.value.data.parsed.info.tokenAmount.uiAmount || 0;
        totalBalance += tokenAmount;
      }
    }
    return totalBalance;
  } catch (error) {
    console.error('[Error] Fetching founder balance:', error);
    return 0;
  }
}

async function getTokenHolderCount(): Promise<number> {
  try {
    const response = await axios.post(HELIUS_URL, {
      jsonrpc: '2.0',
      method: 'getTokenAccounts',
      id: 'helius-test',
      params: {
        page: 1,
        limit: 1000,
        mint: TOKEN_ADDRESS
      }
    });

    const uniqueOwners = new Set(
      response.data.result.token_accounts.map((account: any) => account.owner)
    );
    return uniqueOwners.size;
  } catch (error) {
    console.error('[Error] Fetching holder count:', error);
    return 0;
  }
}

// Cache configuration
let tokenStatsCache = {
  data: null as TokenStats | null,
  timestamp: 0,
  ttl: 60 * 1000 // 1 minute cache
};

// Main stats endpoint
app.get(['/api/stats', '/api/token-stats'], async (req: Request, res: Response) => {
  try {
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
    
    // Fetch all data concurrently
    const [price, totalSupply, founderBalance, holders] = await Promise.all([
      getTokenPrice(),
      fetchTotalTokenSupply(),
      fetchFounderBalance(),
      getTokenHolderCount()
    ]);

    const tokenStats: TokenStats = {
      price,
      totalSupply,
      founderBalance,
      holders,
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

app.options('*', corsConfig);

app.listen(port, () => {
  console.log(`[Server] Running on port ${port}`);
}); 