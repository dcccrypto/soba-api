import express from 'express';
import cors from 'cors';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import rateLimit from 'express-rate-limit';

const app = express();
const port = process.env.PORT || 3001;

// Configure CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use(limiter);

// Solana connection setup
const RPC_ENDPOINTS = [
  process.env.SOLANA_RPC_URL,
  'https://solana-mainnet.rpc.extrnode.com',
  'https://rpc.ankr.com/solana'
].filter(Boolean);

const getWorkingConnection = async () => {
  for (const endpoint of RPC_ENDPOINTS) {
    if (!endpoint) continue;
    try {
      const connection = new Connection(endpoint, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000
      });
      await connection.getSlot();
      return connection;
    } catch (error) {
      console.warn(`Failed to connect to ${endpoint}, trying next...`);
    }
  }
  throw new Error('All RPC endpoints failed');
};

// API Routes
app.get('/api/token-stats', async (req, res) => {
  try {
    const connection = await getWorkingConnection();
    const tokenAddress = '26wx2UwenfvTS8vTrpysPdtDLyCfu47uJ44CpEpD1AQG';
    const founderAddress = '7wtbTXc7Lyxt1enezJa7eNyNxenaLYsmBeiZTsA3KvwL';

    // Fetch all data concurrently
    const [priceData, supplyData, founderBalance] = await Promise.all([
      axios.get(`https://data.solanatracker.io/price?token=${tokenAddress}`, {
        headers: { 'x-api-key': process.env.SOLANA_TRACKER_API_KEY }
      }),
      connection.getTokenSupply(new PublicKey(tokenAddress)),
      fetchFounderBalance(connection, founderAddress, tokenAddress)
    ]);

    res.json({
      price: priceData.data.price,
      totalSupply: supplyData.value.uiAmount,
      founderBalance: founderBalance,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching token stats:', error);
    res.status(500).json({ error: 'Failed to fetch token stats' });
  }
});

async function fetchFounderBalance(connection: Connection, founderAddress: string, tokenAddress: string) {
  const walletPublicKey = new PublicKey(founderAddress);
  const tokenAccounts = await connection.getTokenAccountsByOwner(walletPublicKey, {
    mint: new PublicKey(tokenAddress),
  });

  let totalBalance = 0;
  for (const account of tokenAccounts.value) {
    const accountInfo = await connection.getParsedAccountInfo(account.pubkey);
    if (accountInfo.value?.data && 'parsed' in accountInfo.value.data) {
      totalBalance += accountInfo.value.data.parsed.info.tokenAmount.uiAmount;
    }
  }
  return totalBalance;
}

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
}); 