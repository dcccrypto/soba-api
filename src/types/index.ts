export interface TokenStats {
  price: number;
  totalSupply: number;
  circulatingSupply: number;
  founderBalance: number;
  holders: number;
  marketCap: number;
  totalValue: number;
  founderValue: number;
  toBeBurnedTokens: number;
  toBeBurnedValue: number;
  burnRate: number;
  lastUpdated: string;
  cached?: boolean;
  cacheAge?: number;
}

export interface ErrorResponse {
  error: string;
}