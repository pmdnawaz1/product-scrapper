// services/scraper.js - Main service for scraping product data
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const {
    flipkartScraper,
    amazonScraper,
    myntraScraper,
    ScraperError
} = require('./websiteScrapers');


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
 * Scrape Myntra using Puppeteer
 * @param {string} url - Product page URL
 * @returns {Promise<object>} Scraped product data
 */
const scrapeMyntraWithPuppeteer = async (url) => {
    console.log('Using Puppeteer for Myntra scraping');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait for critical elements to load
        await page.waitForSelector('.pdp-name', { timeout: 5000 }).catch(() => console.log('Title selector not found'));

        // Extract data using Puppeteer's evaluate
        const productData = await page.evaluate(() => {
            // Extract title
            const title = document.querySelector('.pdp-name')?.textContent.trim() ||
                document.querySelector('.pdp-title')?.textContent.trim() || '';

            // Extract price
            const price = document.querySelector('.pdp-price')?.textContent.trim() ||
                document.querySelector('.pdp-mrp')?.textContent.trim() || '';

            // Extract availability
            const soldOut = document.querySelector('.size-buttons-out-of-stock') ||
                !document.querySelector('.pdp-add-to-bag');
            const availability = soldOut ? 'Out of Stock' : 'In Stock';

            // Extract description
            const description = document.querySelector('.pdp-product-description-content')?.textContent.trim() ||
                document.querySelector('.pdp-sizeFitDesc')?.textContent.trim() || '';

            // Extract image URL
            const imageElement = document.querySelector('.image-grid-image') || document.querySelector('.image-grid-containerImg');
            let image_url = '';

            if (imageElement) {
                // Try to get URL from style attribute
                const style = imageElement.getAttribute('style');
                if (style && style.includes('url(')) {
                    image_url = style.match(/url\(['"]?(.*?)['"]?\)/i)?.[1] || '';
                } else {
                    // Try to get from img tag
                    image_url = imageElement.querySelector('img')?.src || '';
                }
            }

            // Extract category
            const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumbs-container a'))
                .map(node => node.textContent.trim());
            const category = breadcrumbs.length > 1 ? breadcrumbs[1] : '';

            // Extract variants (sizes, colors)
            const sizes = Array.from(document.querySelectorAll('.size-buttons-size-button'))
                .map(node => node.textContent.trim());

            const colors = Array.from(document.querySelectorAll('.color-buttonContainer'))
                .map(node => {
                    const colorNode = node.querySelector('.color-swatch');
                    return colorNode ? colorNode.getAttribute('title') : '';
                }).filter(Boolean);

            // Extract weight (usually not directly available)
            const weight = 'Weight information not available';

            // Extract delivery info
            let deliveryInfo = document.querySelector('.delivery-container')?.textContent.trim() || '';
            if (!deliveryInfo) {
                deliveryInfo = 'Delivery information not available';
            }

            // Extract additional product features
            const features = Array.from(document.querySelectorAll('.pdp-product-description li'))
                .map(node => node.textContent.trim());

            // Extract additional images
            const additionalImages = Array.from(document.querySelectorAll('.image-grid-image'))
                .map(node => {
                    const style = node.getAttribute('style');
                    if (style && style.includes('url(')) {
                        return style.match(/url\(['"]?(.*?)['"]?\)/i)?.[1] || '';
                    }
                    return '';
                })
                .filter(Boolean);

            return {
                title,
                price,
                availability,
                description,
                image_url,
                category,
                variants: {
                    sizes: sizes.length > 0 ? sizes : [],
                    colors: colors.length > 0 ? colors : []
                },
                weight,
                delivery_info: deliveryInfo,
                additional_features: features,
                additional_images: additionalImages
            };
        });

        return productData;
    } catch (error) {
        console.error('Puppeteer scraping error:', error);
        throw new ScraperError(`Error scraping Myntra with Puppeteer: ${error.message}`);
    } finally {
        await browser.close();
    }
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

    // For Myntra, use Puppeteer directly
    if (url.includes('myntra.com')) {
        return await scrapeMyntraWithPuppeteer(url);
    }

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
    // Basic validation - just ensure we have at least title and price
    if (!data.title && !data.price) {
        throw new ScraperError(
            `Product data incomplete. Missing basic information.`,
            422
        );
    }
};

module.exports = {
    scrapeProduct,
    ScraperError
};