import express, { Request, Response } from 'express';
import { corsConfig } from './middleware/cors';
import { Connection, PublicKey } from '@solana/web3.js';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import rateLimit from 'express-rate-limit';
import { Options } from 'express-rate-limit';

// Add logger middleware
const logger = (req: Request, res: Response, next: Function) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });
  next();
};

// Extend AxiosRequestConfig to include retry properties
interface RetryConfig extends AxiosRequestConfig {
  retry?: number;
  retryDelay?: number;
}

// Update CacheData interface to handle nullable values
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

const app = express();
const port = process.env.PORT || 3001;

// Add logger middleware
app.use(logger);

// Trust proxy - required for Heroku
app.set('trust proxy', 1);

// Configure CORS with the imported config
app.use(corsConfig);

// Rate limiting with proxy support
const limiterOptions: Partial<Options> = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 300, // Limit each IP to 300 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = req.ip || 
               (req.headers['x-forwarded-for'] as string) || 
               req.socket.remoteAddress || 
               'unknown';
    console.log(`[Rate Limiter] Request from IP: ${ip}`);
    return ip;
  },
  skip: (req) => false, // Replace skipFailedRequests
  handler: (req, res) => {
    console.log(`[Rate Limiter] Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many requests, please try again later.',
      retryAfter: Math.ceil(15 * 60) // 15 minutes in seconds
    });
  }
};

const limiter = rateLimit(limiterOptions);

app.use(limiter);

// Add retry logic for external API calls
const axiosWithRetry = axios.create({
  timeout: 10000,
});

// Cache implementation with proper typing
const cache: Cache = {
  data: null,
  timestamp: 0,
  TTL: 30000
};

axiosWithRetry.interceptors.response.use(undefined, async (err: AxiosError) => {
  const config = err.config as RetryConfig;
  console.log(`[Axios] Request failed: ${err.message}`);
  console.log(`[Axios] URL: ${config?.url}`);
  console.log(`[Axios] Status: ${err.response?.status}`);
  
  if (!config || typeof config.retry === 'undefined') {
    console.log('[Axios] No retry configuration, rejecting');
    return Promise.reject(err);
  }
  
  config.retry--;
  console.log(`[Axios] Retries left: ${config.retry}`);
  
  if (config.retry < 0) {
    console.log('[Axios] No more retries, rejecting');
    return Promise.reject(err);
  }
  
  console.log(`[Axios] Retrying in ${config.retryDelay || 1000}ms`);
  await new Promise(resolve => setTimeout(resolve, config.retryDelay || 1000));
  return axiosWithRetry(config);
});

// Solana connection setup
const RPC_ENDPOINTS = [
  process.env.SOLANA_RPC_URL,
  'https://solana-mainnet.rpc.extrnode.com',
  'https://rpc.ankr.com/solana'
].filter((endpoint): endpoint is string => Boolean(endpoint));

// Add detailed error logging for Solana connection
const getWorkingConnection = async (): Promise<Connection> => {
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      console.log(`[Solana] Attempting to connect to ${endpoint}`);
      const connection = new Connection(endpoint, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000
      });
      
      // Add timeout for getSlot
      const slotPromise = connection.getSlot();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 10000)
      );
      
      const slot = await Promise.race([slotPromise, timeoutPromise]);
      console.log(`[Solana] Successfully connected to ${endpoint} (slot: ${slot})`);
      return connection;
    } catch (error) {
      console.error(`[Solana] Failed to connect to ${endpoint}:`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
  throw new Error('[Solana] All RPC endpoints failed');
};

async function fetchFounderBalance(connection: Connection, founderAddress: string, tokenAddress: string): Promise<number> {
  const walletPublicKey = new PublicKey(founderAddress);
  const tokenAccounts = await connection.getTokenAccountsByOwner(walletPublicKey, {
    mint: new PublicKey(tokenAddress),
  });

  let totalBalance = 0;
  for (const account of tokenAccounts.value) {
    const accountInfo = await connection.getParsedAccountInfo(account.pubkey);
    if (accountInfo.value?.data && 'parsed' in accountInfo.value.data) {
      totalBalance += accountInfo.value.data.parsed.info.tokenAmount.uiAmount || 0;
    }
  }
  return totalBalance;
}

// Update the fetchTokenHolders function to use proper method
async function fetchTokenHolders(connection: Connection, tokenAddress: string): Promise<number> {
  try {
    console.log('[API] Fetching token holders...');
    const tokenKey = new PublicKey(tokenAddress);
    
    // Get all token accounts for this mint
    const accounts = await connection.getParsedProgramAccounts(
      new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), // Token program ID
      {
        filters: [
          {
            dataSize: 165, // Size of token account
          },
          {
            memcmp: {
              offset: 0,
              bytes: tokenKey.toBase58(),
            },
          },
        ],
      }
    );

    // Count all accounts, regardless of balance
    const totalHolders = accounts.length;
    console.log('[API] Total holders fetched successfully:', totalHolders);
    return totalHolders;
  } catch (error) {
    console.error('[API] Error fetching holders:', error);
    return 0;
  }
}

// API Routes
app.get('/api/token-stats', async (_req: Request, res: Response) => {
  console.log('[API] Received token stats request');
  try {
    const now = Date.now();
    if (cache.data && (now - cache.timestamp) < cache.TTL) {
      console.log('[Cache] Returning cached data');
      return res.json({
        ...cache.data,
        cached: true,
        cacheAge: now - cache.timestamp
      });
    }

    console.log('[Cache] Cache miss, fetching fresh data');
    const connection = await getWorkingConnection();
    const tokenAddress = process.env.TOKEN_ADDRESS;
    const founderAddress = process.env.FOUNDER_ADDRESS;

    if (!tokenAddress || !founderAddress) {
      throw new Error('Missing required environment variables');
    }

    console.log('[API] Fetching data from multiple sources...');
    try {
      const [priceData, supplyData, founderBalance, holders] = await Promise.all([
        axiosWithRetry.get<{ price: number }>(
          `https://data.solanatracker.io/price?token=${tokenAddress}`,
          {
            headers: { 'x-api-key': process.env.SOLANA_TRACKER_API_KEY },
            retry: 3,
            retryDelay: 1000,
            timeout: 5000
          } as RetryConfig
        ),
        connection.getTokenSupply(new PublicKey(tokenAddress)),
        fetchFounderBalance(connection, founderAddress, tokenAddress),
        fetchTokenHolders(connection, tokenAddress) // Updated to use connection
      ]);

      const responseData: CacheData = {
        price: priceData.data.price || 0,
        totalSupply: supplyData.value.uiAmount || 0,
        founderBalance: founderBalance || 0,
        holders: holders || 0,
        lastUpdated: new Date().toISOString()
      };

      console.log('[API] Data fetched successfully:', responseData);
      
      cache.data = responseData;
      cache.timestamp = now;
      console.log('[Cache] Cache updated');

      res.json({
        ...responseData,
        cached: false
      });
    } catch (error) {
      console.error('[API] Data fetch error:', error);
      throw error;
    }
  } catch (error) {
    console.error('[API] Error in token stats endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to fetch token stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

export default app; 