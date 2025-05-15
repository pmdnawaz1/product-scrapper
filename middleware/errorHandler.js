// middleware/errorHandler.js - Global error handling middleware
/**
 * Global error handling middleware
 * @param {object} err - Error object
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next middleware function
 */
const errorHandler = (err, req, res, next) => {
    // Log error for debugging
    console.error(`Error: ${err.message}`);
    console.error(err.stack);

    // Determine HTTP status code
    let statusCode = 500;
    let message = 'Internal server error';

    if (err.name === 'AxiosError') {
        switch (err.response?.status) {
            case 404:
                statusCode = 404;
                message = 'Website or product not found';
                break;
            case 403:
                statusCode = 429; // Rate limiting or blocked
                message = 'Access denied by website. This may be due to rate limiting';
                break;
            default:
                statusCode = err.response?.status || 500;
                message = 'Error fetching product data';
        }
    } else if (err.name === 'ScraperError') {
        statusCode = err.statusCode || 400;
        message = err.message;
    }

    // Check if the request is an API call (expecting JSON) or a web request (expecting HTML)
    const isApiRequest = req.originalUrl.startsWith('/product') &&
        req.headers.accept &&
        req.headers.accept.includes('application/json');

    if (isApiRequest) {
        // Return JSON for API requests
        res.status(statusCode).json({
            success: false,
            message,
            error: process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true'
                ? err.message : undefined
        });
    } else {
        // Render error page for web requests
        res.status(statusCode).render('error', {
            message,
            status: statusCode,
            error: process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true'
                ? err : { stack: '' }
        });
    }
};

module.exports = errorHandler;