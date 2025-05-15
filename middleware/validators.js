// middleware/validators.js - Request validation middleware
const { URL } = require('url');

/**
 * Validate the URL query parameter
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next middleware function
 */
const validateUrl = (req, res, next) => {
    const { url } = req.query;
    const config = require('../config');

    // Check if URL parameter exists
    if (!url) {
        return res.status(400).json({
            success: false,
            message: 'URL parameter is required'
        });
    }

    // Validate URL format
    try {
        const parsedUrl = new URL(url);

        // Extract domain from URL
        const hostname = parsedUrl.hostname.toLowerCase();

        // Check if URL is from supported websites by flattening all domain arrays
        const allDomains = [
            ...config.supportedDomains.flipkart,
            ...config.supportedDomains.amazon,
            ...config.supportedDomains.myntra
        ];

        const isSupported = allDomains.some(domain => hostname === domain);

        if (!isSupported) {
            return res.status(400).json({
                success: false,
                message: 'URL is not from a supported website. Supported websites: Flipkart, Amazon India, Myntra'
            });
        }

        // Add domain info to request for easy access in scraper
        req.hostname = hostname;

        // Add website type to request
        if (config.supportedDomains.flipkart.includes(hostname)) {
            req.websiteType = 'flipkart';
        } else if (config.supportedDomains.amazon.includes(hostname)) {
            req.websiteType = 'amazon';
        } else if (config.supportedDomains.myntra.includes(hostname)) {
            req.websiteType = 'myntra';
        }

        next();
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: 'Invalid URL format'
        });
    }
};

module.exports = {
    validateUrl
};