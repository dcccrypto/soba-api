import express, { Request, Response, NextFunction } from 'express';
import { corsConfig } from './middleware/cors.js';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { TokenStats } from './types/index.js';
import NodeCache from 'node-cache';
import { formatNumber, formatPrice, formatUSD } from './utils/format.js';
import memeRoutes from './routes/memes';

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
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=soba&vs_currencies=usd';

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

// Serve uploaded files statically
app.use('/uploads', express.static('public/uploads'));

// Token data fetching functions
async function getTokenPrice(): Promise<number> {
  try {
    console.log('[Price] Fetching token price...');
    const response = await axios.get(COINGECKO_URL);
    const price = response.data?.soba?.usd || 0;

    console.log('[Price] Fetched price:', formatPrice(price));
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
      const amount = supplyResponse.value.amount;
      const decimals = supplyResponse.value.decimals;
      
      if (typeof amount === 'string' && !isNaN(Number(amount)) && typeof decimals === 'number') {
        const supply = Number(amount) / Math.pow(10, decimals);
        console.log('[Supply] Raw amount:', amount);
        console.log('[Supply] Decimals:', decimals);
        console.log('[Supply] Total token supply:', formatNumber(supply), 'tokens');
        return supply;
      }
      console.error('[Supply Error] Invalid supply value:', { amount, decimals });
    } catch (error) {
      console.error(`[Supply Error] Failed with endpoint ${endpoint}:`, error);
      lastError = error;
    }
  }

  // If all endpoints fail, try to get cached value
  const cachedStats = statsCache.get('tokenStats') as TokenStats;
  if (cachedStats?.totalSupply) {
    console.log('[Supply] Using cached total supply:', formatNumber(cachedStats.totalSupply));
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
      if (!account.amount || !account.decimals) {
        console.error(`[Wallet] Invalid account data:`, account);
        return sum;
      }

      const amount = account.amount ? BigInt(account.amount) : BigInt(0);
      const decimals = account.decimals ? Number(account.decimals) : 9; // Default to 9 decimals for SOBA
      
      if (decimals < 0 || decimals > 20) {
        console.error(`[Wallet] Invalid decimals for account:`, account);
        return sum;
      }
      
      const balance = Number(amount) / Math.pow(10, decimals);
      console.log(`[Wallet] Account balance: ${formatNumber(balance)} tokens (raw: ${amount}, decimals: ${decimals})`);
      return sum + balance;
    }, 0);

    if (isNaN(totalBalance)) {
      console.error(`[Wallet] Invalid total balance for ${walletAddress}`);
      return 0;
    }

    console.log(`[Wallet] Total balance for ${walletAddress}: ${formatNumber(totalBalance)} tokens`);
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
    
    // Validate inputs
    if (totalSupply <= 0) {
      console.error('[Error] Invalid total supply:', totalSupply);
      throw new Error('Invalid total supply');
    }

    // Validate wallet balances
    if (founderHoldings > totalSupply) {
      console.error('[Error] Founder balance exceeds total supply:', { founderHoldings, totalSupply });
      throw new Error('Founder balance exceeds total supply');
    }

    if (burnWalletBalance > totalSupply) {
      console.error('[Error] Burn wallet balance exceeds total supply:', { burnWalletBalance, totalSupply });
      throw new Error('Burn wallet balance exceeds total supply');
    }

    // Calculate circulating supply
    const circulatingSupply = Math.max(0, totalSupply - founderHoldings - burnWalletBalance);

    // Validate circulating supply
    if (circulatingSupply > totalSupply) {
      console.error('[Error] Circulating supply exceeds total supply:', { circulatingSupply, totalSupply });
      throw new Error('Circulating supply exceeds total supply');
    }
    
    // Calculate values
    const price = tokenPrice || 0;
    const marketCap = circulatingSupply * price;
    const totalValue = totalSupply * price;
    const founderValue = founderHoldings * price;
    const toBeBurnedValue = burnWalletBalance * price;

    // Calculate burn rate (as percentage of total supply)
    const burnRate = (burnWalletBalance / totalSupply) * 100;

    // Validate calculations
    console.log('\n[Validation] Supply breakdown:');
    console.log(`Total Supply: ${formatNumber(totalSupply)}`);
    console.log(`Founder Holdings: ${formatNumber(founderHoldings)}`);
    console.log(`Burn Wallet: ${formatNumber(burnWalletBalance)}`);
    console.log(`Circulating Supply: ${formatNumber(circulatingSupply)}`);
    console.log(`Sum Check: ${formatNumber(founderHoldings + burnWalletBalance + circulatingSupply)}`);
    console.log(`Burn Rate: ${burnRate.toFixed(2)}%`);

    // Validate sum
    const totalHoldings = founderHoldings + burnWalletBalance + circulatingSupply;
    if (Math.abs(totalHoldings - totalSupply) > 1) { // Allow for small rounding errors
      console.error('[Error] Supply mismatch:', { totalHoldings, totalSupply });
      throw new Error('Supply mismatch');
    }

    const stats = {
      price,
      totalSupply,
      circulatingSupply,
      founderBalance: founderHoldings,
      holders: holders || 0,
      marketCap,
      totalValue,
      founderValue,
      toBeBurnedTokens: burnWalletBalance,
      toBeBurnedValue,
      burnRate,
      lastUpdated: new Date().toISOString(),
      cached: false,
      // Add formatted values
      formatted: {
        price: formatPrice(price),
        totalSupply: formatNumber(totalSupply),
        circulatingSupply: formatNumber(circulatingSupply),
        founderBalance: formatNumber(founderHoldings),
        holders: formatNumber(holders || 0),
        marketCap: formatUSD(marketCap),
        totalValue: formatUSD(totalValue),
        founderValue: formatUSD(founderValue),
        toBeBurnedTokens: formatNumber(burnWalletBalance),
        toBeBurnedValue: formatUSD(toBeBurnedValue),
        burnRate: `${burnRate.toFixed(2)}%`
      }
    };

    // Log summary
    console.log('\n[Stats] Summary:');
    console.log(`- Price: ${formatPrice(price)}`);
    console.log(`- Total Supply: ${formatNumber(totalSupply)} tokens (${formatUSD(totalValue)})`);
    console.log(`- Circulating Supply: ${formatNumber(circulatingSupply)} tokens (${formatUSD(marketCap)})`);
    console.log(`- Founder Balance: ${formatNumber(founderHoldings)} tokens (${formatUSD(founderValue)})`);
    console.log(`- Tokens to be Burned: ${formatNumber(burnWalletBalance)} tokens (${formatUSD(toBeBurnedValue)})`);
    console.log(`- Burn Rate: ${burnRate.toFixed(2)}%`);
    console.log(`- Holders: ${formatNumber(holders)}`);
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
      burnRate: 0,
      lastUpdated: new Date().toISOString(),
      cached: false,
      timestamp: new Date().toISOString(),
      formatted: {
        price: '$0',
        totalSupply: '0',
        circulatingSupply: '0',
        founderBalance: '0',
        holders: '0',
        marketCap: '$0',
        totalValue: '$0',
        founderValue: '$0',
        toBeBurnedTokens: '0',
        toBeBurnedValue: '$0',
        burnRate: '0%'
      }
    });
  }
});

// Routes
app.use('/api/memes', memeRoutes);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`[Server] Running on port ${port}`);
});