// routes/views.js - Routes for web views
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { validateUrl } = require('../middleware/validators');
const config = require('../config');

/**
 * @route   GET /
 * @desc    Home page with form to scrape products
 */
router.get('/', (req, res) => {
    res.render('index', {
        title: 'E-commerce Product Scraper',
        products: null,
        error: null
    });
});

/**
 * @route   POST /scrape
 * @desc    Process form submission and display results
 */
router.post('/scrape', async (req, res) => {
    try {
        const { url } = req.body;

        // Basic URL validation
        if (!url) {
            return res.render('index', {
                title: 'E-commerce Product Scraper',
                products: null,
                error: 'URL is required'
            });
        }

        // Check if it's a list of URLs (one per line)
        const urls = url.split('\n')
            .map(u => u.trim())
            .filter(u => u.length > 0);

        if (urls.length === 0) {
            return res.render('index', {
                title: 'E-commerce Product Scraper',
                products: null,
                error: 'No valid URLs provided'
            });
        }

        // Scrape all products
        const products = [];
        const errors = [];

        for (const productUrl of urls) {
            try {
                // Call the API internally
                const response = await axios.get(`http://localhost:${config.server.port}/product?url=${encodeURIComponent(productUrl)}`, {
                    timeout: 60000 // 60 second timeout for UI requests
                });

                if (response.data && response.data.success && response.data.data) {
                    products.push({
                        ...response.data.data,
                        source_url: productUrl
                    });
                }
            } catch (error) {
                // If a specific product fails, add error but continue with others
                console.error(`Error scraping ${productUrl}:`, error.message);
                errors.push({
                    url: productUrl,
                    message: error.response?.data?.message || error.message
                });
            }
        }
        console.log('Scraped products:', JSON.stringify(products, null, 2));

        // Render the results page
        res.render('index', {
            title: 'E-commerce Product Scraper',
            products,
            error: errors.length > 0 ? errors : null
        });

    } catch (error) {
        res.render('index', {
            title: 'E-commerce Product Scraper',
            products: null,
            error: error.message
        });
    }
});

/**
 * @route   GET /about
 * @desc    About page with API information
 */
router.get('/about', (req, res) => {
    res.render('about', {
        title: 'About the Scraper API'
    });
});

module.exports = router;