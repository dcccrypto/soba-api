import express, { Request, Response, NextFunction } from 'express';
import { corsConfig } from './middleware/cors.js';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { TokenStats } from './types/index.js';
import NodeCache from 'node-cache';

// Configuration
const SOLANA_RPC_ENDPOINTS = [
  process.env.SOLANA_RPC_ENDPOINT || '',
  'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com'
];
const SOLANA_TRACKER_API_KEY = process.env.SOLANA_TRACKER_API_KEY || '';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || '';
const FOUNDER_WALLET = process.env.FOUNDER_WALLET || '';
const BURN_WALLET = process.env.BURN_WALLET || '';
const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Validate configuration
[
  ['SOLANA_RPC_ENDPOINT', SOLANA_RPC_ENDPOINTS[0]],
  ['SOLANA_TRACKER_API_KEY', SOLANA_TRACKER_API_KEY],
  ['HELIUS_API_KEY', HELIUS_API_KEY],
  ['TOKEN_ADDRESS', TOKEN_ADDRESS],
  ['FOUNDER_WALLET', FOUNDER_WALLET],
  ['BURN_WALLET', BURN_WALLET]
].forEach(([name, value]) => {
  if (!value) {
    console.error(`${name} is not configured`);
    process.exit(1);
  }
});

const app = express();

// Apply CORS first
app.use(corsConfig);

// Then apply rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] as string || '127.0.0.1'
});
app.use(limiter);

// Add CORS headers to all responses
app.use((req, res, next) => {
  // Log CORS-related info
  console.log('[CORS] Request from:', req.headers.origin);
  console.log('[CORS] Request method:', req.method);
  
  // Ensure CORS headers are set
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Origin, Accept, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  next();
});

// Token data fetching functions
async function getTokenPrice(): Promise<number> {
  try {
    const response = await axios.get('https://data.solanatracker.io/price', {
      params: { token: TOKEN_ADDRESS },
      headers: { 'x-api-key': SOLANA_TRACKER_API_KEY }
    });
    const price = response.data.price || 0;
    console.log('[Price] Fetched price:', price, 'USD');
    return price;
  } catch (error) {
    console.error('[Price Error] Fetching token price:', error);
    return 0;
  }
}

async function getTokenSupply(connection: Connection): Promise<number> {
  let lastError = null;
  
  // Try each RPC endpoint
  for (const endpoint of SOLANA_RPC_ENDPOINTS) {
    try {
      console.log(`[Supply] Trying RPC endpoint: ${endpoint}`);
      const conn = new Connection(endpoint);
      const mintPublicKey = new PublicKey(TOKEN_ADDRESS);
      const supplyResponse = await conn.getTokenSupply(mintPublicKey);
      const supply = supplyResponse.value.uiAmount;
      
      if (typeof supply === 'number' && !isNaN(supply)) {
        console.log('[Supply] Total token supply:', supply.toLocaleString(), 'tokens');
        return supply;
      }
      console.error('[Supply Error] Invalid supply value:', supply);
    } catch (error) {
      console.error(`[Supply Error] Failed with endpoint ${endpoint}:`, error);
      lastError = error;
    }
  }

  // If all endpoints fail, try to get cached value
  const cachedStats = statsCache.get('tokenStats') as TokenStats;
  if (cachedStats?.totalSupply) {
    console.log('[Supply] Using cached total supply:', cachedStats.totalSupply);
    return cachedStats.totalSupply;
  }

  console.error('[Supply Error] All endpoints failed:', lastError);
  return 0;
}

async function getWalletBalance(walletAddress: string, connection: Connection): Promise<number> {
  try {
    console.log(`[Wallet] Fetching balance for wallet: ${walletAddress}`);
    const response = await axios.post(HELIUS_URL, {
      jsonrpc: '2.0',
      method: 'getTokenAccounts',
      id: 'helius-test',
      params: {
        mint: TOKEN_ADDRESS,
        owner: walletAddress
      }
    });

    if (!response.data.result?.token_accounts) {
      console.log(`[Wallet] No token accounts found for ${walletAddress}`);
      return 0;
    }

    const totalBalance = response.data.result.token_accounts.reduce((sum: number, account: any) => {
      const amount = account.amount ? Number(account.amount) : 0;
      const decimals = account.decimals ? Number(account.decimals) : 0;
      if (isNaN(amount) || isNaN(decimals)) {
        console.error(`[Wallet] Invalid amount or decimals for account:`, account);
        return sum;
      }
      return sum + (amount / Math.pow(10, decimals));
    }, 0);

    if (isNaN(totalBalance)) {
      console.error(`[Wallet] Invalid total balance for ${walletAddress}`);
      return 0;
    }

    console.log(`[Wallet] Balance for ${walletAddress}: ${totalBalance.toLocaleString()} tokens`);
    return totalBalance;
  } catch (error) {
    console.error(`[Wallet Error] Fetching balance for wallet ${walletAddress}:`, error);
    return 0;
  }
}

async function getHolderCount(): Promise<number> {
  try {
    let page = 1;
    const uniqueOwners = new Set<string>();
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

      if (!response.data.result?.token_accounts || response.data.result.token_accounts.length === 0) {
        break;
      }

      const accounts = response.data.result.token_accounts;
      totalAccounts += accounts.length;
      
      accounts.forEach((account: any) => {
        if (account.owner) {
          uniqueOwners.add(account.owner);
        }
      });

      if (accounts.length < 1000) {
        break;
      }
      page++;
    }

    console.log('[Holders] Final count:', uniqueOwners.size);
    return uniqueOwners.size;
  } catch (error) {
    console.error('[Holders Error] Fetching holder count:', error);
    return 0;
  }
}

// Cache configuration
const statsCache = new NodeCache({ stdTTL: 60 }); // 60 seconds TTL

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/token-stats', async (req: Request, res: Response) => {
  try {
    console.log('[Stats] Token stats request received');
    console.log('[Headers] Origin:', req.headers.origin);
    console.log('[Headers] Referer:', req.headers.referer);
    
    // Check cache
    const cachedStats = statsCache.get('tokenStats');
    if (cachedStats) {
      console.log('[Cache] Returning cached stats');
      const cacheAge = statsCache.getTtl('tokenStats');
      return res.json({
        ...cachedStats,
        cached: true,
        cacheAge: cacheAge ? Math.floor((cacheAge - Date.now()) / 1000) : null
      });
    }

    // Fetch all data
    console.time('[Stats] Total fetch time');
    const [tokenPrice, tokenSupply, founderBalance, toBeBurnedTokens, holders] = await Promise.all([
      getTokenPrice(),
      getTokenSupply(new Connection(SOLANA_RPC_ENDPOINTS[0])),
      getWalletBalance(FOUNDER_WALLET, new Connection(HELIUS_URL)),
      getWalletBalance(BURN_WALLET, new Connection(HELIUS_URL)),
      getHolderCount()
    ]);
    console.timeEnd('[Stats] Total fetch time');

    // Calculate metrics
    const totalSupply = tokenSupply || 0;
    const founderHoldings = founderBalance || 0;
    const burnWalletBalance = toBeBurnedTokens || 0;
    
    // Circulating supply = Total supply - (Founder balance + Burn wallet balance)
    const circulatingSupply = Math.max(0, totalSupply - (founderHoldings + burnWalletBalance));
    
    const marketCap = circulatingSupply * (tokenPrice || 0);
    const totalValue = totalSupply * (tokenPrice || 0);
    const founderValue = founderHoldings * (tokenPrice || 0);
    const toBeBurnedValue = burnWalletBalance * (tokenPrice || 0);

    const stats = {
      price: tokenPrice || 0,
      totalSupply,
      circulatingSupply,
      founderBalance: founderHoldings,
      holders: holders || 0,
      marketCap,
      totalValue,
      founderValue,
      toBeBurnedTokens: burnWalletBalance,
      toBeBurnedValue,
      lastUpdated: new Date().toISOString(),
      cached: false
    };

    // Log summary
    console.log('\n[Stats] Summary:');
    console.log(`- Price: $${tokenPrice.toFixed(12)}`);
    console.log(`- Total Supply: ${totalSupply.toLocaleString()} tokens ($${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
    console.log(`- Circulating Supply: ${circulatingSupply.toLocaleString()} tokens ($${marketCap.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
    console.log(`- Founder Balance: ${founderHoldings.toLocaleString()} tokens ($${founderValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
    console.log(`- Tokens to be Burned: ${burnWalletBalance.toLocaleString()} tokens ($${toBeBurnedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
    console.log(`- Holders: ${holders.toLocaleString()}`);
    console.log(`- Last Updated: ${stats.lastUpdated}`);

    // Cache the results
    statsCache.set('tokenStats', stats);
    console.log('[Cache] Stats cached successfully');

    res.json(stats);
  } catch (error) {
    console.error('[Error] Failed to fetch token stats:', error);
    res.status(500).json({ 
      error: 'Failed to fetch token stats',
      message: error instanceof Error ? error.message : String(error),
      price: 0,
      totalSupply: 0,
      circulatingSupply: 0,
      founderBalance: 0,
      holders: 0,
      marketCap: 0,
      totalValue: 0,
      founderValue: 0,
      toBeBurnedTokens: 0,
      toBeBurnedValue: 0,
      lastUpdated: new Date().toISOString(),
      cached: false,
      timestamp: new Date().toISOString()
    });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`[Server] Running on port ${port}`);
});