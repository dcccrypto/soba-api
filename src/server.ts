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
const TOKEN_ADDRESS = '26wx2UwenfvTS8vTrpysPdtDLyCfu47uJ44CpEpD1AQG';
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
    const price = response.data.price || 0;
    console.log('[Price] Fetched price:', price, 'USD');
    return price;
  } catch (error) {
    console.error('[Price Error] Fetching token price:', error);
    return 0;
  }
}

async function fetchTotalTokenSupply(): Promise<number> {
  try {
    const connection = new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
    const mintPublicKey = new PublicKey(TOKEN_ADDRESS);
    const supplyResponse = await connection.getTokenSupply(mintPublicKey);
    const supply = supplyResponse.value.uiAmount || 0;
    console.log('[Supply] Total token supply:', supply.toLocaleString(), 'tokens');
    return supply;
  } catch (error) {
    console.error('[Supply Error] Fetching total supply:', error);
    return 0;
  }
}

async function fetchFounderBalance(): Promise<number> {
  try {
    const connection = new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
    const walletPublicKey = new PublicKey(FOUNDER_WALLET);
    console.log('[Founder] Fetching balance for wallet:', FOUNDER_WALLET);
    
    const tokenAccounts = await connection.getTokenAccountsByOwner(walletPublicKey, {
      mint: new PublicKey(TOKEN_ADDRESS)
    });

    console.log('[Founder] Found', tokenAccounts.value.length, 'token accounts');
    
    let totalBalance = 0;
    for (const account of tokenAccounts.value) {
      const accountInfo = await connection.getParsedAccountInfo(account.pubkey);
      if (accountInfo.value && 'parsed' in accountInfo.value.data) {
        const tokenAmount = accountInfo.value.data.parsed.info.tokenAmount.uiAmount || 0;
        console.log('[Founder] Account', account.pubkey.toString(), 'balance:', tokenAmount);
        totalBalance += tokenAmount;
      }
    }
    
    console.log('[Founder] Total founder balance:', totalBalance.toLocaleString(), 'tokens');
    return totalBalance;
  } catch (error) {
    console.error('[Founder Error] Fetching founder balance:', error);
    return 0;
  }
}

async function getTokenHolderCount(): Promise<number> {
  try {
    let page = 1;
    const uniqueOwners = new Set();
    let totalAccounts = 0;

    while (true) {
      console.log('[Holders] Fetching page', page);
      const response = await axios.post(HELIUS_URL, {
        jsonrpc: '2.0',
        method: 'getTokenAccounts',
        id: 'helius-test',
        params: {
          page,
          limit: 1000,
          mint: TOKEN_ADDRESS
        }
      });

      if (!response.data.result || !response.data.result.token_accounts || response.data.result.token_accounts.length === 0) {
        console.log('[Holders] No more pages to fetch');
        break;
      }

      const accounts = response.data.result.token_accounts;
      totalAccounts += accounts.length;
      
      accounts.forEach((account: any) => {
        if (account.owner && account.token_amount && account.token_amount.ui_amount > 0) {
          uniqueOwners.add(account.owner);
        }
      });

      console.log(`[Holders] Page ${page}: Found ${accounts.length} accounts, ${uniqueOwners.size} unique holders so far`);
      
      if (accounts.length < 1000) {
        break;
      }
      page++;
    }

    console.log('[Holders] Final stats:');
    console.log(`- Total accounts processed: ${totalAccounts}`);
    console.log(`- Total unique holders: ${uniqueOwners.size}`);
    
    return uniqueOwners.size;
  } catch (error) {
    console.error('[Holders Error] Fetching holder count:', error instanceof Error ? error.message : 'Unknown error');
    if (axios.isAxiosError(error) && error.response) {
      console.error('[Holders Error] Response data:', error.response.data);
    }
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
      console.log('[Cache] Returning cached data from', new Date(tokenStatsCache.timestamp).toISOString());
      console.log('[Cache] Data:', JSON.stringify(tokenStatsCache.data, null, 2));
      return res.json({
        ...tokenStatsCache.data,
        cached: true,
        cacheAge: Math.floor((now - tokenStatsCache.timestamp) / 1000)
      });
    }

    console.log('[API] Fetching fresh token stats...');
    console.time('[API] Total fetch time');
    
    const [price, totalSupply, founderBalance, holders] = await Promise.all([
      getTokenPrice(),
      fetchTotalTokenSupply(),
      fetchFounderBalance(),
      getTokenHolderCount()
    ]);

    console.timeEnd('[API] Total fetch time');

    const tokenStats: TokenStats = {
      price,
      totalSupply,
      founderBalance,
      holders,
      lastUpdated: new Date().toISOString()
    };

    // Calculate and log percentages
    const founderPercentage = totalSupply > 0 ? (founderBalance / totalSupply) * 100 : 0;
    const circulatingSupply = totalSupply - founderBalance;
    const circulatingPercentage = totalSupply > 0 ? (circulatingSupply / totalSupply) * 100 : 0;

    console.log('\n[Stats] Summary:');
    console.log(`- Price: $${price.toFixed(12)}`);
    console.log(`- Total Supply: ${totalSupply.toLocaleString()} tokens`);
    console.log(`- Circulating Supply: ${circulatingSupply.toLocaleString()} tokens (${circulatingPercentage.toFixed(2)}%)`);
    console.log(`- Founder Balance: ${founderBalance.toLocaleString()} tokens (${founderPercentage.toFixed(2)}%)`);
    console.log(`- Unique Holders: ${holders.toLocaleString()}`);
    console.log(`- Last Updated: ${tokenStats.lastUpdated}`);

    tokenStatsCache = {
      data: tokenStats,
      timestamp: now,
      ttl: 60 * 1000
    };

    res.json(tokenStats);
  } catch (error) {
    console.error('[Error] Error fetching token stats:', error instanceof Error ? error.message : 'Unknown error');
    if (axios.isAxiosError(error) && error.response) {
      console.error('[Error] Response data:', error.response.data);
    }
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