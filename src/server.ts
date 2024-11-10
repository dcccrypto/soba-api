import express, { Request, Response } from 'express';
import { corsConfig } from './middleware/cors';
import { Connection, PublicKey } from '@solana/web3.js';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import rateLimit from 'express-rate-limit';

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
  lastUpdated: string;
}

interface Cache {
  data: CacheData | null;
  timestamp: number;
  TTL: number;
}

const app = express();
const port = process.env.PORT || 3001;

// Configure CORS with the imported config
app.use(corsConfig);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

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
  if (!config || typeof config.retry === 'undefined') {
    return Promise.reject(err);
  }
  config.retry--;
  if (config.retry < 0) {
    return Promise.reject(err);
  }
  await new Promise(resolve => setTimeout(resolve, config.retryDelay || 1000));
  return axiosWithRetry(config);
});

// Solana connection setup
const RPC_ENDPOINTS = [
  process.env.SOLANA_RPC_URL,
  'https://solana-mainnet.rpc.extrnode.com',
  'https://rpc.ankr.com/solana'
].filter((endpoint): endpoint is string => Boolean(endpoint));

const getWorkingConnection = async (): Promise<Connection> => {
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const connection = new Connection(endpoint, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000
      });
      await connection.getSlot();
      return connection;
    } catch (error) {
      console.warn(`Failed to connect to ${endpoint}, trying next...`);
    }
  }
  throw new Error('All RPC endpoints failed');
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

// API Routes
app.get('/api/token-stats', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    if (cache.data && (now - cache.timestamp) < cache.TTL) {
      return res.json(cache.data);
    }

    const connection = await getWorkingConnection();
    const tokenAddress = process.env.TOKEN_ADDRESS;
    const founderAddress = process.env.FOUNDER_ADDRESS;

    if (!tokenAddress || !founderAddress) {
      throw new Error('Missing required environment variables');
    }

    const [priceData, supplyData, founderBalance] = await Promise.all([
      axiosWithRetry.get<{ price: number }>(`https://data.solanatracker.io/price?token=${tokenAddress}`, {
        headers: { 'x-api-key': process.env.SOLANA_TRACKER_API_KEY },
        retry: 3,
        retryDelay: 1000,
      } as RetryConfig),
      connection.getTokenSupply(new PublicKey(tokenAddress)),
      fetchFounderBalance(connection, founderAddress, tokenAddress)
    ]);

    // Add null checks and provide default values
    const responseData: CacheData = {
      price: priceData.data.price || 0,
      totalSupply: supplyData.value.uiAmount || 0,
      founderBalance: founderBalance || 0,
      lastUpdated: new Date().toISOString()
    };

    cache.data = responseData;
    cache.timestamp = now;

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching token stats:', error);
    res.status(500).json({ 
      error: 'Failed to fetch token stats',
      details: process.env.NODE_ENV === 'development' ? 
        error instanceof Error ? error.message : String(error) : 
        undefined
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