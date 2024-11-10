import express from 'express';
import { corsConfig } from './middleware/cors.js';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import fetch from 'node-fetch';
import pkg from 'limiter';
const { RateLimiter } = pkg;
// Add logger middleware with correct Response type from express
const logger = (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
    });
    next();
};
const app = express();
const port = process.env.PORT || 3001;
// Fix logger middleware application
app.use((req, res, next) => logger(req, res, next));
// Trust proxy - required for Heroku
app.set('trust proxy', 1);
// Configure CORS with the imported config
app.use(corsConfig);
// Rate limiting with proxy support
const limiterOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 300, // Limit each IP to 300 requests per windowMs
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const ip = req.ip ||
            req.headers['x-forwarded-for'] ||
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
const cache = {
    data: null,
    timestamp: 0,
    TTL: 30000
};
axiosWithRetry.interceptors.response.use(undefined, async (err) => {
    const config = err.config;
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
].filter(Boolean);
// Add connection management
let currentRpcIndex = 0;
let solanaConnection = null;
const getWorkingConnection = async () => {
    if (solanaConnection) {
        try {
            // Test if current connection is working
            await solanaConnection.getSlot();
            return solanaConnection;
        }
        catch (error) {
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
        }
        catch (error) {
            console.error(`[RPC] Failed to connect to ${endpoint}:`, error);
        }
    }
    throw new Error('Unable to connect to any Solana RPC endpoint');
};
async function fetchFounderBalance(connection, founderAddress, tokenAddress) {
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
// Add Helius configuration
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
// Update the token holders fetch function with proper typing
async function fetchTokenHoldersFromHelius(tokenAddress) {
    try {
        console.log('[API] Fetching token holders from Helius...');
        let page = 1;
        const uniqueOwners = new Set();
        while (true) {
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
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            if (!data.result?.token_accounts || data.result.token_accounts.length === 0) {
                console.log(`[API] Completed fetching holders. Total pages: ${page - 1}`);
                break;
            }
            console.log(`[API] Processing holders from page ${page}`);
            data.result.token_accounts.forEach((account) => uniqueOwners.add(account.owner));
            page++;
        }
        const holderCount = uniqueOwners.size;
        console.log('[API] Total unique holders:', holderCount);
        return holderCount;
    }
    catch (error) {
        console.error('[API] Error fetching token holders from Helius:', error);
        throw error;
    }
}
// Update the token-stats endpoint
app.get('/api/token-stats', async (_req, res) => {
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
        const connection = await getWorkingConnection();
        const tokenAddress = process.env.TOKEN_ADDRESS;
        const founderAddress = process.env.FOUNDER_ADDRESS;
        if (!tokenAddress || !founderAddress) {
            throw new Error('Missing required environment variables');
        }
        // Fetch all data using both Solana RPC and Helius
        const [tokenSupply, founderAccount, holdersCount] = await Promise.all([
            connection.getTokenSupply(new PublicKey(tokenAddress)),
            connection.getParsedTokenAccountsByOwner(new PublicKey(founderAddress), {
                mint: new PublicKey(tokenAddress)
            }),
            fetchTokenHoldersFromHelius(tokenAddress) // Use new Helius function
        ]);
        const founderBalance = founderAccount.value[0]?.account.data.parsed.info.tokenAmount.uiAmount || 0;
        const responseData = {
            price: cache.data?.price || 0, // Keep last known price if available
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
        return;
    }
    catch (error) {
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
        return;
    }
});
// Health check endpoint
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
