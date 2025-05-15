// services/websiteScrapers.js - Specific scrapers for each website
const { ScraperError } = require('./scraper');

/**
 * Extract product information from Flipkart
 * @param {object} $ - Cheerio instance loaded with HTML
 * @param {string} url - Original product URL
 * @returns {object} Extracted product data
 */
const flipkartScraper = ($, url) => {
    try {
        console.log("Running Flipkart scraper...");

        // Debug: Log some info to help understand page structure
        console.log("Page body classes:", $('body').attr('class'));
        console.log("Found product container?", $('._1AtVbE._3qGmMb').length > 0 ? "Yes" : "No");

        // Extracting product title - try multiple selectors
        let title = '';
        const titleSelectors = [
            'span.B_NuCI',
            'h1.yhB1nd',
            '.B_NuCI',
            '._35KyD6',
            '.ooJZfD._3FGKt6',
            'h1._30KBpcF',
            'h1[class^="_30"]'
        ];

        for (const selector of titleSelectors) {
            const element = $(selector);
            if (element.length) {
                title = element.text().trim();
                console.log(`Found title using selector "${selector}": ${title}`);
                break;
            }
        }

        // Extracting price - try multiple selectors
        let price = '';
        const priceSelectors = [
            '._30jeq3._16Jk6d',
            '._25b18c',
            '._30jeq3',
            '.ooJZfD .dyC4hf',
            '._1vC4OE._3qQ9m1',
            'div[class^="_30jeq3"]'
        ];

        for (const selector of priceSelectors) {
            const element = $(selector);
            if (element.length) {
                price = element.text().trim();
                console.log(`Found price using selector "${selector}": ${price}`);
                break;
            }
        }

        // Extracting availability - several ways to detect this
        let availability = 'Out of Stock';
        const stockIndicators = [
            $('#pincodeInputId'),
            $('._1AtVbE'),
            $('._16FRp0'),
            $('button._2KpZ6l._2U9uOA._3v1-ww'),  // Add to Cart button
            $('button:contains("BUY NOW")'),
            $('button:contains("ADD TO CART")')
        ];

        if (stockIndicators.some(el => el.length > 0)) {
            availability = 'In Stock';
            console.log("Product appears to be in stock");
        }

        // Check for explicit out-of-stock indicators
        const outOfStockIndicators = [
            $('div:contains("This item is out of stock")'),
            $('div:contains("Currently unavailable")'),
            $('div:contains("Sold Out")')
        ];

        if (outOfStockIndicators.some(el => el.length > 0 && el.text().trim().length > 0)) {
            availability = 'Out of Stock';
            console.log("Product explicitly marked as out of stock");
        }

        // Extracting product description - try multiple selectors
        let description = '';
        const descriptionSelectors = [
            '._1mXcCf.RmoJUa',
            '._1AN87F',
            'div[class^="_2418kt"]',
            '.X3BRps',
            '._3u-uqB',
            '.ooJZfD .ooJZfD'
        ];

        for (const selector of descriptionSelectors) {
            const element = $(selector);
            if (element.length) {
                description = element.text().trim();
                console.log(`Found description using selector "${selector}": ${description.substring(0, 100)}...`);
                break;
            }
        }

        // If description still not found, try to get it from product features
        if (!description) {
            const features = $('._2418kt ul li').map((i, el) => $(el).text().trim()).get().join('. ');
            if (features) {
                description = features;
                console.log(`Found description from features list: ${description.substring(0, 100)}...`);
            }
        }

        // Extracting image URL - try multiple selectors
        let image_url = '';
        const imageSelectors = [
            'img._396cs4',
            'img[class^="q6DClP"]',
            'img._2r_T1I',
            'img._1Nyybr',
            '.ooJZfD img',
            '.q6DClP',
            '._3SQWE6',
            'img[class^="_396"]',
            '.CXW8mj img'
        ];

        for (const selector of imageSelectors) {
            const element = $(selector);
            if (element.length) {
                // Try both src and data-src attributes
                image_url = element.attr('src') || element.attr('data-src');
                if (image_url) {
                    console.log(`Found image URL using selector "${selector}": ${image_url}`);
                    break;
                }
            }
        }

        // Last resort - look for any large image on the page
        if (!image_url) {
            $('img').each((i, el) => {
                const img = $(el);
                const src = img.attr('src') || img.attr('data-src');
                const width = parseInt(img.attr('width') || '0');
                const height = parseInt(img.attr('height') || '0');

                // Consider a larger image as a product image
                if (src && (width > 200 || height > 200 || src.includes('product'))) {
                    image_url = src;
                    console.log(`Found potential product image: ${image_url}`);
                    return false; // break the loop
                }
            });
        }

        // Check for JSON-LD data which is more reliable
        const jsonLdScript = $('script[type="application/ld+json"]').html();
        if (jsonLdScript) {
            try {
                const jsonLdArray = JSON.parse(jsonLdScript);
                const jsonLd = Array.isArray(jsonLdArray) ? jsonLdArray.find(obj => obj['@type'] === 'Product') : jsonLdArray;

                if (jsonLd) {
                    console.log("Found JSON-LD product data");

                    if (!title && jsonLd.name) {
                        title = jsonLd.name;
                        console.log(`Found title from JSON-LD: ${title}`);
                    }

                    if (!price && jsonLd.offers && jsonLd.offers.price) {
                        price = `₹${jsonLd.offers.price}`;
                        console.log(`Found price from JSON-LD: ${price}`);
                    }

                    if (jsonLd.offers && jsonLd.offers.availability) {
                        availability = jsonLd.offers.availability.includes('InStock') ? 'In Stock' : 'Out of Stock';
                        console.log(`Found availability from JSON-LD: ${availability}`);
                    }

                    if (!description && jsonLd.description) {
                        description = jsonLd.description;
                        console.log(`Found description from JSON-LD: ${description.substring(0, 100)}...`);
                    }

                    if (!image_url && jsonLd.image) {
                        image_url = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
                        console.log(`Found image URL from JSON-LD: ${image_url}`);
                    }
                }
            } catch (e) {
                console.error("Error parsing JSON-LD:", e.message);
            }
        }

        // Last resort for title: use page title if nothing else worked
        if (!title) {
            title = $('title').text().trim().replace(' - Flipkart.com', '');
            console.log(`Using page title as fallback: ${title}`);
        }

        return {
            title: title || 'Title not found',
            price: price || 'Price not available',
            availability,
            description: description || 'Description not available',
            image_url: image_url || ''
        };
    } catch (error) {
        console.error("Flipkart scraper error:", error);
        throw new ScraperError(`Error parsing Flipkart product: ${error.message}`);
    }
};

/**
 * Extract product information from Amazon.in
 * @param {object} $ - Cheerio instance loaded with HTML
 * @param {string} url - Original product URL
 * @returns {object} Extracted product data
 */
const amazonScraper = ($, url) => {
    try {
        // Extracting product title
        const title = $('#productTitle').text().trim() ||
            $('.a-size-large.product-title-word-break').text().trim();

        // Extracting price
        const price = $('.a-price .a-offscreen').first().text().trim() ||
            $('#priceblock_ourprice').text().trim() ||
            $('#priceblock_dealprice').text().trim();

        // Extracting availability
        let availability = 'Out of Stock';
        if ($('#availability span').text().trim().toLowerCase().includes('in stock') ||
            $('.a-color-success').text().trim().toLowerCase().includes('in stock')) {
            availability = 'In Stock';
        }

        // Extracting product description
        const description = $('#productDescription p').text().trim() ||
            $('#feature-bullets .a-list-item').text().trim() ||
            $('.a-expander-content').text().trim();

        // Extracting image URL
        let image_url = $('#landingImage').attr('src') ||
            $('#imgBlkFront').attr('src') ||
            $('.a-dynamic-image').attr('src');

        // Sometimes Amazon uses data-old-hires for high-res images
        if (!image_url) {
            image_url = $('#landingImage').attr('data-old-hires') ||
                $('.a-dynamic-image').attr('data-old-hires');
        }

        return {
            title: title || 'Title not found',
            price: price || 'Price not available',
            availability,
            description: description || 'Description not available',
            image_url: image_url || ''
        };
    } catch (error) {
        throw new ScraperError(`Error parsing Amazon.in product: ${error.message}`);
    }
};

/**
 * Extract product information from Myntra
 * @param {object} $ - Cheerio instance loaded with HTML
 * @param {string} url - Original product URL
 * @returns {object} Extracted product data
 */
const myntraScraper = ($, url) => {
    try {
        // Myntra uses a lot of JavaScript to render content
        // This makes scraping with just Cheerio challenging
        // We'll try to extract what's available in the HTML

        // Extracting product title
        const title = $('h1.pdp-title').text().trim() ||
            $('h1.pdp-name').text().trim();

        // Extracting price
        const price = $('.pdp-price').text().trim() ||
            $('.pdp-mrp').text().trim();

        // Extracting availability
        let availability = 'Out of Stock';
        if (!$('.size-buttons-out-of-stock').length || $('.pdp-add-to-bag').length) {
            availability = 'In Stock';
        }

        // Extracting product description
        const description = $('.pdp-product-description-content').text().trim() ||
            $('.pdp-sizeFitDesc').text().trim();

        // Extracting image URL
        let image_url = $('.image-grid-image').first().attr('style');

        // Myntra often embeds the image URL in a style attribute
        if (image_url && image_url.includes('url(')) {
            image_url = image_url.match(/url\(['"]?(.*?)['"]?\)/i)[1];
        } else {
            image_url = $('.image-grid-image img').attr('src') ||
                $('.pdp-image img').attr('src');
        }

        // For cases where we couldn't find data in HTML, we can try to extract from JSON-LD
        const jsonLdScript = $('script[type="application/ld+json"]').html();
        if (jsonLdScript) {
            try {
                const jsonLd = JSON.parse(jsonLdScript);
                if (!title && jsonLd.name) title = jsonLd.name;
                if (!price && jsonLd.offers && jsonLd.offers.price) {
                    price = `₹${jsonLd.offers.price}`;
                }
                if (jsonLd.offers && jsonLd.offers.availability) {
                    availability = jsonLd.offers.availability.includes('InStock') ? 'In Stock' : 'Out of Stock';
                }
                if (!description && jsonLd.description) description = jsonLd.description;
                if (!image_url && jsonLd.image) image_url = jsonLd.image;
            } catch (e) {
                // Silently handle JSON parsing errors
            }
        }

        return {
            title: title || 'Title not found',
            price: price || 'Price not available',
            availability,
            description: description || 'Description not available',
            image_url: image_url || ''
        };
    } catch (error) {
        throw new ScraperError(`Error parsing Myntra product: ${error.message}`);
    }
};

module.exports = {
    flipkartScraper,
    amazonScraper,
    myntraScraper
};