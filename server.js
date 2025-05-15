// server.js - Main entry point for the API
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const productRoutes = require('./routes/product');
const viewRoutes = require('./routes/views');
const errorHandler = require('./middleware/errorHandler');
const config = require('./config');

const app = express();
const PORT = config.server.port;

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Security middleware - with CSP adjustments to allow inline styles for EJS
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https:", "http:"],
            fontSrc: ["'self'", "https://cdn.jsdelivr.net"]
        }
    }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
if (config.server.env === 'development' || config.debug) {
    app.use(morgan('dev'));
}

// Rate limiting to prevent abuse
const limiter = rateLimit(config.rateLimit);
app.use('/product', limiter); // Apply rate limiting only to API routes

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

// Routes
app.use('/', viewRoutes);
app.use('/product', productRoutes);

// 404 handler
app.use((req, res, next) => {
    res.status(404).render('error', {
        message: 'Page not found',
        status: 404,
        error: { stack: '' }
    });
});

// Error handling middleware
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} in ${config.server.env} mode`);
    if (config.debug) {
        console.log('Debug mode: ENABLED');
    }
});

module.exports = app; // For testing purposes