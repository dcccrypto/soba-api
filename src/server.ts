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

const app = express();
app.use(corsConfig);

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
  try {
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
      return sum + (account.amount ? Number(account.amount) / Math.pow(10, account.decimals) : 0);
    }, 0);

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
    const [tokenPrice, tokenSupply, founderBalance, burnedTokens, holders] = await Promise.all([
      getTokenPrice(),
      getTokenSupply(new Connection(HELIUS_URL)),
      getWalletBalance(FOUNDER_WALLET, new Connection(HELIUS_URL)),
      getWalletBalance(BURN_WALLET, new Connection(HELIUS_URL)),
      getHolderCount()
    ]);
    console.timeEnd('[Stats] Total fetch time');

    // Calculate metrics
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

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`[Server] Running on port ${port}`);
});