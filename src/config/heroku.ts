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
    'https://gyevw.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://212.219.39.146:3000',
    'http://212.219.39.146:3001',
    'https://soba-api-v1-127255a88636.herokuapp.com',
    'https://soba-api-ec0b8a7a21a7.herokuapp.com'
  ]
}