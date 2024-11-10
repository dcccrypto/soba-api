"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = require("./middleware/cors");
const web3_js_1 = require("@solana/web3.js");
const axios_1 = __importDefault(require("axios"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const limiter_1 = require("limiter");
// Add logger middleware
const logger = (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
    });
    next();
};
const app = (0, express_1.default)();
const port = process.env.PORT || 3001;
// Add logger middleware
app.use(logger);
// Trust proxy - required for Heroku
app.set('trust proxy', 1);
// Configure CORS with the imported config
app.use(cors_1.corsConfig);
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
const limiter = (0, express_rate_limit_1.default)(limiterOptions);
app.use(limiter);
// Add retry logic for external API calls
const axiosWithRetry = axios_1.default.create({
    timeout: 10000,
});
// Cache implementation with proper typing
const cache = {
    data: null,
    timestamp: 0,
    TTL: 30000
};
axiosWithRetry.interceptors.response.use(undefined, async (err) => {
    var _a;
    const config = err.config;
    console.log(`[Axios] Request failed: ${err.message}`);
    console.log(`[Axios] URL: ${config === null || config === void 0 ? void 0 : config.url}`);
    console.log(`[Axios] Status: ${(_a = err.response) === null || _a === void 0 ? void 0 : _a.status}`);
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
].filter((endpoint) => Boolean(endpoint));
// Add detailed error logging for Solana connection
const getWorkingConnection = async () => {
    for (const endpoint of RPC_ENDPOINTS) {
        try {
            console.log(`[Solana] Attempting to connect to ${endpoint}`);
            const connection = new web3_js_1.Connection(endpoint, {
                commitment: 'confirmed',
                confirmTransactionInitialTimeout: 60000
            });
            // Add timeout for getSlot
            const slotPromise = connection.getSlot();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000));
            const slot = await Promise.race([slotPromise, timeoutPromise]);
            console.log(`[Solana] Successfully connected to ${endpoint} (slot: ${slot})`);
            return connection;
        }
        catch (error) {
            console.error(`[Solana] Failed to connect to ${endpoint}:`, {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
        }
    }
    throw new Error('[Solana] All RPC endpoints failed');
};
async function fetchFounderBalance(connection, founderAddress, tokenAddress) {
    var _a;
    const walletPublicKey = new web3_js_1.PublicKey(founderAddress);
    const tokenAccounts = await connection.getTokenAccountsByOwner(walletPublicKey, {
        mint: new web3_js_1.PublicKey(tokenAddress),
    });
    let totalBalance = 0;
    for (const account of tokenAccounts.value) {
        const accountInfo = await connection.getParsedAccountInfo(account.pubkey);
        if (((_a = accountInfo.value) === null || _a === void 0 ? void 0 : _a.data) && 'parsed' in accountInfo.value.data) {
            totalBalance += accountInfo.value.data.parsed.info.tokenAmount.uiAmount || 0;
        }
    }
    return totalBalance;
}
// Update the rate limiter initialization
const holdersRateLimiter = new limiter_1.RateLimiter({
    tokensPerInterval: 1,
    interval: "second"
});
// Update the fetchTokenHolders function with proper rate limiting
async function fetchTokenHolders(tokenAddress) {
    var _a, _b;
    try {
        console.log('[API] Fetching token holders from Solana Tracker...');
        // Wait for rate limit before making request
        await holdersRateLimiter.removeTokens(1);
        const response = await axiosWithRetry.get(`https://data.solanatracker.io/tokens/${tokenAddress}/holders`, {
            headers: {
                'x-api-key': process.env.SOLANA_TRACKER_API_KEY,
                'Accept': 'application/json'
            },
            retry: 2,
            retryDelay: 1100,
            timeout: 15000
        });
        if (response.data && Array.isArray(response.data)) {
            const holderCount = response.data.length;
            console.log('[API] Holders count calculated:', holderCount);
            return holderCount;
        }
        console.warn('[API] Unexpected holders data format:', response.data);
        return 0;
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error) && ((_a = error.response) === null || _a === void 0 ? void 0 : _a.status) === 429) {
            console.error('[API] Rate limit exceeded for holders endpoint. Retrying after delay...');
            // Wait for 1.1 seconds before retrying
            await new Promise(resolve => setTimeout(resolve, 1100));
            return fetchTokenHolders(tokenAddress); // Retry once
        }
        console.error('[API] Error fetching holders:', {
            status: axios_1.default.isAxiosError(error) ? (_b = error.response) === null || _b === void 0 ? void 0 : _b.status : undefined,
            message: error instanceof Error ? error.message : String(error)
        });
        return 0;
    }
}
// Update the token-stats endpoint to handle rate limits better
app.get('/api/token-stats', async (_req, res) => {
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
        const tokenAddress = process.env.TOKEN_ADDRESS;
        const founderAddress = process.env.FOUNDER_ADDRESS;
        if (!tokenAddress || !founderAddress) {
            throw new Error('Missing required environment variables');
        }
        console.log('[API] Fetching data from multiple sources...');
        try {
            // Sequential fetching for better rate limit handling
            const priceResponse = await axiosWithRetry.get(`https://data.solanatracker.io/price?token=${tokenAddress}`, {
                headers: { 'x-api-key': process.env.SOLANA_TRACKER_API_KEY },
                retry: 2,
                retryDelay: 1100,
                timeout: 10000
            }).catch(error => {
                console.error('[API] Price fetch error:', error);
                return { data: { price: 0 } };
            });
            // Wait briefly before next request
            await new Promise(resolve => setTimeout(resolve, 100));
            const holdersCount = await fetchTokenHolders(tokenAddress).catch(error => {
                console.error('[API] Holders fetch error:', error);
                return 0;
            });
            // Wait briefly before next request
            await new Promise(resolve => setTimeout(resolve, 100));
            const supplyResponse = await axiosWithRetry.get(`https://data.solanatracker.io/supply?token=${tokenAddress}`, {
                headers: { 'x-api-key': process.env.SOLANA_TRACKER_API_KEY },
                retry: 2,
                retryDelay: 1100,
                timeout: 10000
            }).catch(error => {
                console.error('[API] Supply fetch error:', error);
                return { data: { supply: 996758135.0228987 } };
            });
            const responseData = {
                price: priceResponse.data.price || 0,
                totalSupply: supplyResponse.data.supply || 996758135.0228987,
                founderBalance: 260660000,
                holders: holdersCount,
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
        }
        catch (error) {
            console.error('[API] Data fetch error:', error);
            throw error;
        }
    }
    catch (error) {
        console.error('[API] Error in token stats endpoint:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        res.status(500).json({
            error: 'Failed to fetch token stats',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
// Health check endpoint
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
exports.default = app;
