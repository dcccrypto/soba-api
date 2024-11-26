export const herokuConfig = {
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  solanaRpcEndpoint: process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
  solanaTrackerApiKey: process.env.SOLANA_TRACKER_API_KEY,
  heliusApiKey: process.env.HELIUS_API_KEY,
  tokenAddress: process.env.TOKEN_ADDRESS || '25p2BoNp6qrJH5As6ek6H7Ei495oSkyZd3tGb97sqFmH',
  founderWallet: process.env.FOUNDER_WALLET || 'D2y4sbmBuSjLU1hfrZbBCaveCHjk952c9VsGwfxnNNNH',
  corsOrigins: [
    'https://soba.vercel.app',
    'https://www.soba.vercel.app',
    'http://localhost:3000'
  ]
} 