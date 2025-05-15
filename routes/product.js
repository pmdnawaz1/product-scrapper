const express = require('express');
const router = express.Router();
const { validateUrl } = require('../middleware/validators');
const { scrapeProduct } = require('../services/scraper');

/**
 * @route   GET /product
 * @desc    Scrape product details from supported e-commerce websites
 * @param   {string} url - URL of the product page
 * @return  {object} Product details (title, price, availability, description, image_url)
 */
router.get('/', validateUrl, async (req, res, next) => {
    try {
        const { url } = req.query;
        const productData = await scrapeProduct(url);

        if (!productData) {
            return res.status(404).json({
                success: false,
                message: 'Product details not found'
            });
        }

        return res.status(200).json({
            success: true,
            data: productData
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;