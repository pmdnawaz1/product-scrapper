// services/scraper.js - Main service for scraping product data
const axios = require('axios');
const cheerio = require('cheerio');
const {
    flipkartScraper,
    amazonScraper,
    myntraScraper
} = require('./websiteScrapers');

// Custom error class for scraper-specific errors
class ScraperError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'ScraperError';
        this.statusCode = statusCode;
    }
}

/**
 * Configure axios with user agent and timeout
 * @returns {object} Configured axios instance
 */
const createAxiosInstance = () => {
    return axios.create({
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        },
        timeout: 15000, // 15 seconds
        maxRedirects: 10, // Increased redirects limit
        validateStatus: status => status < 500, // Accept all responses below 500
        followRedirect: true, // Ensure redirects are followed
    });
};

/**
 * Get the appropriate scraper based on the URL
 * @param {string} url - Product page URL
 * @returns {Function} Website-specific scraper function
 */
const getScraperByUrl = (url) => {
    if (url.includes('flipkart.com')) {
        return flipkartScraper;
    } else if (url.includes('amazon.in')) {
        return amazonScraper;
    } else if (url.includes('amzn.in')) {
        return amazonScraper;
    }
    else if (url.includes('myntra.com')) {
        return myntraScraper;
    }
    throw new ScraperError('Unsupported website', 400);
};

/**
 * Scrape product data from a given URL
 * @param {string} url - Product page URL
 * @returns {Promise<object>} Scraped product data
 */
const scrapeProduct = async (url) => {
    console.log(`Scraping URL: ${url}`);
    const axiosInstance = createAxiosInstance();
    const scraper = getScraperByUrl(url);

    try {
        // Fetch the HTML content of the page
        const response = await axiosInstance.get(url);

        if (response.status >= 400) {
            throw new ScraperError('Failed to fetch product page', response.status);
        }

        // Store the final URL after any redirects for debugging
        console.log(`Original URL: ${url}`);
        console.log(`Final URL after redirects: ${response.request.res.responseUrl || url}`);

        // For Flipkart short URLs, we might need to handle the redirect manually
        let finalUrl = url;
        if (url.includes('dl.flipkart.com') && response.request && response.request.res) {
            finalUrl = response.request.res.responseUrl || url;

            // If we got redirected but the page doesn't have our product info,
            // try fetching again with the new URL
            if (finalUrl !== url) {
                console.log(`Fetching redirected URL: ${finalUrl}`);
                const redirectResponse = await axiosInstance.get(finalUrl);
                if (redirectResponse.status === 200) {
                    // Use this response instead
                    response.data = redirectResponse.data;
                }
            }
        }

        // Load HTML into cheerio
        const $ = cheerio.load(response.data);

        // For debugging, dump some basic info about the page
        console.log(`Page title: ${$('title').text()}`);

        // Use website-specific scraper to extract data
        const productData = scraper($, finalUrl);

        // Validate scraped data
        validateScrapedData(productData);

        return productData;
    } catch (error) {
        if (error instanceof ScraperError) {
            throw error;
        } else if (error.response) {
            // Handle axios response errors
            throw new ScraperError(
                `Error fetching product data: ${error.message}`,
                error.response.status
            );
        } else {
            // Handle network errors or other issues
            throw new ScraperError(
                `Error scraping product: ${error.message}`,
                500
            );
        }
    }
};

/**
 * Validate that scraped data contains all required fields
 * @param {object} data - Scraped product data
 * @throws {ScraperError} If required fields are missing
 */
const validateScrapedData = (data) => {
    const requiredFields = ['title', 'price', 'availability', 'description', 'image_url'];
    const missingFields = requiredFields.filter(field => !data[field]);

    if (missingFields.length > 0) {
        throw new ScraperError(
            `Product data incomplete. Missing fields: ${missingFields.join(', ')}`,
            422
        );
    }
};

module.exports = {
    scrapeProduct,
    ScraperError
};