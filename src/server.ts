import express, { Request, Response } from 'express';
import { corsConfig } from './middleware/cors';
import { Connection, PublicKey } from '@solana/web3.js';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import rateLimit from 'express-rate-limit';
import { Options } from 'express-rate-limit';
import { RateLimiter } from 'limiter';

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

// Add RPC endpoints configuration
const RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com',
  'https://rpc.ankr.com/solana',
  process.env.CUSTOM_RPC_URL, // Add your custom RPC URL from env if available
].filter(Boolean) as string[];

// Add connection management
let currentRpcIndex = 0;
let solanaConnection: Connection | null = null;

const getWorkingConnection = async (): Promise<Connection> => {
  if (solanaConnection) {
    try {
      // Test if current connection is working
      await solanaConnection.getSlot();
      return solanaConnection;
    } catch (error) {
      console.log('[RPC] Current connection failed, trying next endpoint');
    }
  }

  // Try each RPC endpoint until one works
  for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
    currentRpcIndex = (currentRpcIndex + 1) % RPC_ENDPOINTS.length;
    const endpoint = RPC_ENDPOINTS[currentRpcIndex];
    
    try {
      console.log(`[RPC] Trying endpoint: ${endpoint}`);
      const connection = new Connection(endpoint, 'confirmed');
      await connection.getSlot(); // Test the connection
      
      solanaConnection = connection;
      console.log(`[RPC] Successfully connected to: ${endpoint}`);
      return connection;
    } catch (error) {
      console.error(`[RPC] Failed to connect to ${endpoint}:`, error);
    }
  }

  throw new Error('Unable to connect to any Solana RPC endpoint');
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

// Update the rate limiter initialization
const holdersRateLimiter = new RateLimiter({
  tokensPerInterval: 1,
  interval: "second"
});

// Add this helper function to get token holders count
async function fetchTokenHoldersFromRPC(connection: Connection, tokenAddress: string): Promise<number> {
  try {
    console.log('[API] Fetching token holders from Solana RPC...');
    
    const tokenAccounts = await connection.getParsedProgramAccounts(
      new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), // Token Program ID
      {
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: tokenAddress,
            },
          },
        ],
      }
    );

    const holderCount = tokenAccounts.length;
    console.log('[API] Holders count calculated:', holderCount);
    return holderCount;
  } catch (error) {
    console.error('[API] Error fetching token holders:', error);
    throw error;
  }
}

// Update the token-stats endpoint
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

    // Fetch all data using Solana RPC
    const [tokenSupply, founderAccount, holdersCount] = await Promise.all([
      connection.getTokenSupply(new PublicKey(tokenAddress)),
      connection.getParsedTokenAccountsByOwner(new PublicKey(founderAddress), {
        mint: new PublicKey(tokenAddress)
      }),
      fetchTokenHoldersFromRPC(connection, tokenAddress)
    ]);

    const founderBalance = founderAccount.value[0]?.account.data.parsed.info.tokenAmount.uiAmount || 0;

    const responseData: CacheData = {
      price: cache.data?.price || 0, // Keep last known price if available
      totalSupply: tokenSupply.value.uiAmount ?? 0,
      founderBalance,
      holders: holdersCount,
      lastUpdated: new Date().toISOString()
    };

    console.log('[API] Data fetched successfully:', responseData);
    
    cache.data = responseData;
    cache.timestamp = now;

    return res.json({
      ...responseData,
      cached: false
    });

  } catch (error) {
    console.error('[API] Error:', error);
    if (cache.data) {
      return res.json({
        ...cache.data,
        cached: true,
        error: 'Failed to fetch fresh data'
      });
    }
    return res.status(500).json({ error: 'Failed to fetch token stats' });
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