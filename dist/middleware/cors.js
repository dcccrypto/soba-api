import cors from 'cors';
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['https://bosabastard.com'];
export const corsConfig = cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET'],
    credentials: true,
    maxAge: 86400, // 24 hours
});
