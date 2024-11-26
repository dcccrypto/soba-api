import express from 'express';
import { corsConfig } from './middleware/cors.js';
import rateLimit from 'express-rate-limit';
import { herokuConfig } from './config/heroku.js';
import { errorHandler } from './middleware/error.js';
import helmet from 'helmet';
const app = express();
const port = herokuConfig.port;
// Security middleware
app.use(helmet());
app.set('trust proxy', 1);
// CORS and rate limiting
app.use(corsConfig);
app.use(rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false
}));
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: herokuConfig.nodeEnv
    });
});
// Main stats endpoint with error handling
app.get(['/api/stats', '/api/token-stats'], async (req, res, next) => {
    try {
        // ... rest of your existing endpoint code ...
    }
    catch (error) {
        next(error);
    }
});
// Error handling
app.use(errorHandler);
// Start server
app.listen(port, () => {
    console.log(`[Server] Running on port ${port} in ${herokuConfig.nodeEnv} mode`);
});
// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('[Uncaught Exception]', error);
    process.exit(1);
});
process.on('unhandledRejection', (error) => {
    console.error('[Unhandled Rejection]', error);
    process.exit(1);
});
