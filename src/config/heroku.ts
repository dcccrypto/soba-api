import { config } from 'dotenv';

config();

export const HEROKU_CONFIG = {
  PORT: process.env.PORT || 3001,
  SOLANA_RPC_ENDPOINT: process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
  SOLANA_TRACKER_API_KEY: process.env.SOLANA_TRACKER_API_KEY,
  HELIUS_API_KEY: process.env.HELIUS_API_KEY,
  TOKEN_ADDRESS: process.env.TOKEN_ADDRESS || 'AZsHEMXd7BFK1nKL6corC9VdQXLiLwrcpBUhgTpbwsKG',
  FOUNDER_WALLET: process.env.FOUNDER_WALLET || 'D2y4sbmBuSjLU1hfrZbBCaveCHjk952c9VsGwfxnNNNH',
  BURN_WALLET: process.env.BURN_WALLET || '7wtbTXc7Lyxt1enezJa7eNyNxenaLYsmBeiZTsA3KvwL',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  NODE_ENV: process.env.NODE_ENV || 'development',
  CACHE_TTL: parseInt(process.env.CACHE_TTL || '60'), // Cache time in seconds
  RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW || '900000'), // 15 minutes in milliseconds
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '100'), // Maximum requests per window
};

export type HerokuConfig = typeof HEROKU_CONFIG;