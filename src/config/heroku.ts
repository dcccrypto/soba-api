export const herokuConfig = {
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  solanaRpcEndpoint: process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
  solanaTrackerApiKey: process.env.SOLANA_TRACKER_API_KEY,
  heliusApiKey: process.env.HELIUS_API_KEY,
  tokenAddress: process.env.TOKEN_ADDRESS,
  founderWallet: process.env.FOUNDER_WALLET,
  corsOrigins: [
    'https://soba.vercel.app',
    'https://www.gyevw.vercel.app',
    'http://localhost:3000'
  ]
} 