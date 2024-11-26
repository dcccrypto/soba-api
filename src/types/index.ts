export interface TokenStats {
  price: number;
  totalSupply: number;
  founderBalance: number;
  holders: number;
  lastUpdated: string;
  marketCap?: number;
  volume24h?: number;
  priceChange24h?: number;
  burnedTokens?: number;
  burnRate?: number;
  circulatingSupply?: number;
}

export interface ErrorResponse {
  error: string;
} 