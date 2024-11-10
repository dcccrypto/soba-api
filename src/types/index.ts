export interface TokenStats {
  price: number;
  totalSupply: number;
  founderBalance: number;
  holders: number;
  lastUpdated: string;
  cached?: boolean;
  cacheAge?: number;
}

export interface ErrorResponse {
  error: string;
} 