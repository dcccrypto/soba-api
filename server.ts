// Add at the top of your server.ts
import axios from 'axios';

// Add retry logic for external API calls
const axiosWithRetry = axios.create({
  timeout: 10000,
});

axiosWithRetry.interceptors.response.use(undefined, async (err) => {
  const { config, message } = err;
  if (!config || !config.retry) {
    return Promise.reject(err);
  }
  config.retry -= 1;
  if (config.retry === 0) {
    return Promise.reject(err);
  }
  const backoff = new Promise(resolve => {
    setTimeout(() => resolve(null), config.retryDelay || 1000);
  });
  await backoff;
  return axiosWithRetry(config);
});

// Add simple in-memory cache
const cache = {
  data: null,
  timestamp: 0,
  TTL: 30000 // 30 seconds
};

// Update your token-stats endpoint to use cache
app.get('/api/token-stats', async (req, res) => {
  try {
    const now = Date.now();
    if (cache.data && (now - cache.timestamp) < cache.TTL) {
      return res.json(cache.data);
    }

    const connection = await getWorkingConnection();
    const tokenAddress = process.env.TOKEN_ADDRESS;
    const founderAddress = process.env.FOUNDER_ADDRESS;

    const [priceData, supplyData, founderBalance] = await Promise.all([
      axiosWithRetry.get(`https://data.solanatracker.io/price?token=${tokenAddress}`, {
        headers: { 'x-api-key': process.env.SOLANA_TRACKER_API_KEY },
        retry: 3,
        retryDelay: 1000,
      }),
      connection.getTokenSupply(new PublicKey(tokenAddress)),
      fetchFounderBalance(connection, founderAddress, tokenAddress)
    ]);

    const responseData = {
      price: priceData.data.price,
      totalSupply: supplyData.value.uiAmount,
      founderBalance: founderBalance,
      lastUpdated: new Date().toISOString()
    };

    cache.data = responseData;
    cache.timestamp = now;

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching token stats:', error);
    res.status(500).json({ 
      error: 'Failed to fetch token stats',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update rate limiting configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // increase limit
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
}); 