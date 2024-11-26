import cors from 'cors';
const allowedOrigins = [
    'http://localhost:3000',
    'https://gyevw.vercel.app',
    process.env.FRONTEND_URL
].filter(Boolean);
export const corsConfig = cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
});
