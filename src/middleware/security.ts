import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';

export const securityMiddleware = [
  helmet(),
  (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  }
]; 