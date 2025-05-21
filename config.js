// config.js - Configuration settings for the API
require('dotenv').config(); // Load environment variables from .env file
module.exports = {
    // General API settings
    server: {
        port: process.env.PORT,
        env: process.env.NODE_ENV || 'development'
    },

    // Rate limiting configuration
    rateLimit: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // limit each IP to 100 requests per windowMs
        message: 'Too many requests from this IP, please try again later'
    },

    // HTTP request configuration
    request: {
        timeout: 15000, // 15 seconds
        maxRedirects: 10,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
    },
    geminiApiKey: process.env.GEMINI_API_KEY || '', // Gemini API key for AI enhancements

    // Supported websites
    supportedDomains: {
        flipkart: ['flipkart.com', 'www.flipkart.com', 'dl.flipkart.com'],
        amazon: ['amazon.in', 'www.amazon.in', 'amzn.in'],
        myntra: ['myntra.com', 'www.myntra.com'],
        snapdeal: ['snapdeal.com', 'www.snapdeal.com'],
    },

    // Debug mode (set to true for detailed logging)
    debug: process.env.DEBUG === 'true' || false
};