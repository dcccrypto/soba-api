export interface TokenStats {
  price: number;
  totalSupply: number;
  founderBalance: number;
  holders: number;
  lastUpdated: string;
}

export interface ErrorResponse {
  error: string;
}