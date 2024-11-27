import express, { Request, Response, NextFunction } from 'express';
import { corsConfig } from './middleware/cors.js';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { TokenStats } from './types/index.js';
import NodeCache from 'node-cache';

// Configuration
const SOLANA_RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT || '';
const SOLANA_TRACKER_API_KEY = process.env.SOLANA_TRACKER_API_KEY || '';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || '';
const FOUNDER_WALLET = process.env.FOUNDER_WALLET || '';
const BURN_WALLET = process.env.BURN_WALLET || '';
const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Validate configuration
[
  ['SOLANA_RPC_ENDPOINT', SOLANA_RPC_ENDPOINT],
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

// Solana Tracker API client
const apiClient = axios.create({
  baseURL: 'https://data.solanatracker.io',
  headers: { 'x-api-key': SOLANA_TRACKER_API_KEY }
});

const statsCache = new NodeCache({ stdTTL: 60 }); // Cache for 1 minute

const app = express();
const port = process.env.PORT || 3001;

app.set('trust proxy', 1);
app.use(corsConfig);

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 60 : 120,
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
    console.log('[Price] Fetching token price...');
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

async function getTokenSupply(connection: Connection): Promise<number> {
  try {
    console.log('[Supply] Fetching total supply...');
    const tokenPubkey = new PublicKey(TOKEN_ADDRESS);
    const supply = await connection.getTokenSupply(tokenPubkey);
    const totalSupply = Number(supply.value.amount);
    console.log('[Supply] Total supply:', totalSupply.toLocaleString(), 'tokens');
    return totalSupply;
  } catch (error) {
    console.error('[Supply Error] Fetching token supply:', error);
    return 0;
  }
}

async function getWalletBalance(walletAddress: string, connection: Connection): Promise<number> {
  try {
    console.log(`[Wallet] Fetching balance for wallet ${walletAddress}...`);
    const walletPubkey = new PublicKey(walletAddress);
    const accounts = await connection.getTokenAccountsByOwner(walletPubkey, {
      mint: new PublicKey(TOKEN_ADDRESS)
    });
    
    let totalBalance = 0;
    for (const account of accounts.value) {
      const accountInfo = await connection.getParsedAccountInfo(account.pubkey);
      if (accountInfo.value && 'parsed' in accountInfo.value.data) {
        const balance = accountInfo.value.data.parsed.info.tokenAmount.uiAmount || 0;
        totalBalance += balance;
      }
    }
    
    console.log(`[Wallet] Total balance for wallet ${walletAddress}:`, totalBalance.toLocaleString(), 'tokens');
    return totalBalance;
  } catch (error) {
    console.error(`[Wallet Error] Fetching balance for wallet ${walletAddress}:`, error);
    return 0;
  }
}

async function getHolderCount(): Promise<number> {
  try {
    console.log('[Holders] Fetching holder count...');
    let page = 1;
    const uniqueHolders = new Set<string>();
    
    while (true) {
      const response = await axios.post(HELIUS_URL, {
        jsonrpc: '2.0',
        id: 'holder-count',
        method: 'getTokenAccounts',
        params: {
          mint: TOKEN_ADDRESS,
          page,
          limit: 1000
        }
      });

      const accounts = response.data.result?.token_accounts || [];
      if (accounts.length === 0) break;

      accounts.forEach((account: any) => {
        if (account.owner) uniqueHolders.add(account.owner);
      });

      console.log(`[Holders] Page ${page}: Found ${accounts.length} accounts`);
      
      if (accounts.length < 1000) break;
      page++;
    }

    console.log('[Holders] Total unique holders:', uniqueHolders.size);
    return uniqueHolders.size;
  } catch (error) {
    console.error('[Holders Error] Fetching holder count:', error);
    return 0;
  }
}

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/token-stats', async (req: Request, res: Response) => {
  try {
    console.log('[Stats] Token stats request received');
    
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

    // Validate RPC connection
    console.log('[RPC] Connecting to Solana...');
    const connection = new Connection(SOLANA_RPC_ENDPOINT);
    const version = await connection.getVersion();
    console.log('[RPC] Connected, version:', version);

    // Fetch all data
    console.time('[Stats] Total fetch time');
    const [tokenPrice, tokenSupply, founderBalance, burnedTokens, holders] = await Promise.all([
      getTokenPrice(),
      getTokenSupply(connection),
      getWalletBalance(FOUNDER_WALLET, connection),
      getWalletBalance(BURN_WALLET, connection),
      getHolderCount()
    ]);
    console.timeEnd('[Stats] Total fetch time');

    // Calculate derived metrics
    const circulatingSupply = tokenSupply - founderBalance - burnedTokens;
    const marketCap = circulatingSupply * tokenPrice;
    const totalValue = tokenSupply * tokenPrice;
    const founderValue = founderBalance * tokenPrice;
    const burnedValue = burnedTokens * tokenPrice;

    const stats = {
      price: tokenPrice,
      totalSupply: tokenSupply,
      circulatingSupply,
      founderBalance,
      holders,
      marketCap,
      totalValue,
      founderValue,
      burnedTokens,
      burnedValue,
      lastUpdated: new Date().toISOString(),
      cached: false
    };

    // Log summary
    console.log('\n[Stats] Summary:');
    console.log(`- Price: $${tokenPrice.toFixed(12)}`);
    console.log(`- Total Supply: ${tokenSupply.toLocaleString()} tokens ($${totalValue.toFixed(2)})`);
    console.log(`- Circulating Supply: ${circulatingSupply.toLocaleString()} tokens ($${marketCap.toFixed(2)})`);
    console.log(`- Founder Balance: ${founderBalance.toLocaleString()} tokens ($${founderValue.toFixed(2)})`);
    console.log(`- Burned Tokens: ${burnedTokens.toLocaleString()} tokens ($${burnedValue.toFixed(2)})`);
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
      timestamp: new Date().toISOString()
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`[Server] Running on port ${port}`);
});