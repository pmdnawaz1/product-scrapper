// const { ScraperError } = require('./scraper');

class ScraperError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'ScraperError';
        this.statusCode = statusCode;
    }
}

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

        // Extract category information
        let category = '';
        const categorySelectors = [
            '._1MR4o5 ._3khuHA',
            '._3Uw3qF li',
            '.V31g3Y'
        ];

        for (const selector of categorySelectors) {
            const elements = $(selector);
            if (elements.length) {
                category = elements.eq(1).text().trim(); // Usually second item in breadcrumbs
                console.log(`Found category: ${category}`);
                break;
            }
        }

        // Extract variants (size, color)
        const variants = {
            sizes: [],
            colors: []
        };

        // Look for size options
        const sizeSelectors = [
            '._3Oikkn ._1fGeJ5',
            '.dyC4hf ._2OTVHf ._1q8vHb'
        ];

        for (const selector of sizeSelectors) {
            const elements = $(selector);
            if (elements.length) {
                elements.each((i, el) => {
                    variants.sizes.push($(el).text().trim());
                });
                console.log(`Found sizes: ${variants.sizes.join(', ')}`);
                break;
            }
        }

        // Look for color options
        const colorSelectors = [
            '._3Oikkn ._3Oikkn ._1q8vHb',
            '.dyC4hf .dyC4hf ._1q8vHb'
        ];

        for (const selector of colorSelectors) {
            const elements = $(selector);
            if (elements.length) {
                elements.each((i, el) => {
                    variants.colors.push($(el).text().trim());
                });
                console.log(`Found colors: ${variants.colors.join(', ')}`);
                break;
            }
        }

        // Extract delivery information
        let deliveryInfo = 'Delivery information not available';
        const deliverySelectors = [
            '#pincodeInputId',
            '._3XINqE',
            '._1KOFUF'
        ];

        for (const selector of deliverySelectors) {
            const element = $(selector);
            if (element.length) {
                // Try to find text related to delivery
                const deliveryText = element.closest('div').find('span').text().trim();
                if (deliveryText) {
                    deliveryInfo = deliveryText;
                    console.log(`Found delivery info: ${deliveryInfo}`);
                    break;
                }
            }
        }

        // Estimate weight if not explicitly mentioned
        let weight = '';

        // Look for weight in description or specs
        const weightRegex = /(\d+\.?\d*)\s*(kg|g|grams|kilograms|gram|kilogram)/i;
        const potentialWeightText = description + ' ' + $('._14cfVK').text();
        const weightMatch = potentialWeightText.match(weightRegex);

        if (weightMatch) {
            weight = weightMatch[0];
            console.log(`Found weight information: ${weight}`);
        } else {
            weight = 'Weight information not available';
        }

        // Extract additional product features
        const features = [];
        $('._2418kt ul li').each((i, el) => {
            features.push($(el).text().trim());
        });

        // Get additional images
        const additionalImages = [];
        $('._3GnUWp li img').each((i, el) => {
            const imgSrc = $(el).attr('src') || $(el).attr('data-src');
            if (imgSrc && !additionalImages.includes(imgSrc)) {
                additionalImages.push(imgSrc);
            }
        });

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

                    if (!category && jsonLd.category) {
                        category = jsonLd.category;
                        console.log(`Found category from JSON-LD: ${category}`);
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
            image_url: image_url || '',
            category: category || 'Category not available',
            variants,
            weight,
            delivery_info: deliveryInfo,
            additional_features: features,
            additional_images: additionalImages
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

        // Extract category
        let category = '';
        $('#wayfinding-breadcrumbs_feature_div ul li').each((i, el) => {
            if (i === 1) { // Usually second item in breadcrumbs
                category = $(el).text().trim();
            }
        });

        // Extract variants
        const variants = {
            sizes: [],
            colors: []
        };

        // Size options
        $('#variation_size_name ul li').each((i, el) => {
            const sizeText = $(el).text().trim();
            if (sizeText) variants.sizes.push(sizeText);
        });

        // Color options
        $('#variation_color_name ul li').each((i, el) => {
            const colorText = $(el).attr('title')?.replace('Click to select ', '') || '';
            if (colorText) variants.colors.push(colorText);
        });

        // Delivery information
        let deliveryInfo = '';
        $('#mir-layout-DELIVERY_BLOCK').each((i, el) => {
            deliveryInfo = $(el).text().trim();
        });

        if (!deliveryInfo) {
            deliveryInfo = $('#deliveryBlockMessage').text().trim() ||
                'Delivery information not available';
        }

        // Extract weight
        let weight = '';
        $('.po-item-weight .a-span9').each((i, el) => {
            weight = $(el).text().trim();
        });

        if (!weight) {
            // Try to estimate from product details
            const productDetailsText = $('#productDetails').text();
            const weightRegex = /(\d+\.?\d*)\s*(kg|g|grams|kilograms|gram|kilogram)/i;
            const weightMatch = productDetailsText.match(weightRegex);

            if (weightMatch) {
                weight = weightMatch[0];
            } else {
                weight = 'Weight information not available';
            }
        }

        // Additional features
        const features = [];
        $('#feature-bullets li').each((i, el) => {
            const featureText = $(el).text().trim();
            if (featureText && !featureText.includes('See more')) {
                features.push(featureText);
            }
        });

        // Additional images
        const additionalImages = [];
        $('#altImages li img').each((i, el) => {
            const imgSrc = $(el).attr('src');
            if (imgSrc && imgSrc.includes('images/I/')) {
                // Convert thumbnail URL to full-size image
                const fullSizeImg = imgSrc.replace(/\._.*?_\./, '.');
                additionalImages.push(fullSizeImg);
            }
        });

        return {
            title: title || 'Title not found',
            price: price || 'Price not available',
            availability,
            description: description || 'Description not available',
            image_url: image_url || '',
            category: category || 'Category not available',
            variants,
            weight,
            delivery_info: deliveryInfo,
            additional_features: features,
            additional_images: additionalImages
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

        let category = '';
        const variants = {
            sizes: [],
            colors: []
        };
        let weight = 'Weight information not available';
        let deliveryInfo = 'Delivery information not available';
        const features = [];
        const additionalImages = [];

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
                if (jsonLd.category) category = jsonLd.category;
            } catch (e) {
                // Silently handle JSON parsing errors
                console.error("Error parsing Myntra JSON-LD:", e.message);
            }
        }

        // Try to extract size options
        $('.size-buttons-size-button').each((i, el) => {
            const sizeText = $(el).text().trim();
            if (sizeText) {
                variants.sizes.push(sizeText);
            }
        });

        // Extract color options
        $('.colors-container .color-label').each((i, el) => {
            const colorText = $(el).text().trim();
            if (colorText) {
                variants.colors.push(colorText);
            }
        });

        // Try to get additional images
        $('.image-grid-imageContainer').each((i, el) => {
            const style = $(el).attr('style');
            if (style && style.includes('url(')) {
                const imgMatch = style.match(/url\(['"]?(.*?)['"]?\)/i);
                if (imgMatch && imgMatch[1] && !additionalImages.includes(imgMatch[1])) {
                    additionalImages.push(imgMatch[1]);
                }
            }
        });

        // Extract product features
        $('.pdp-product-description-content li').each((i, el) => {
            features.push($(el).text().trim());
        });

        // Note: For Myntra, many details are loaded dynamically, so we're returning limited data
        // The puppeteer-based scraper in scraper.js will be more reliable for Myntra

        return {
            title: title || 'Title not found',
            price: price || 'Price not available',
            availability,
            description: description || 'Description not available',
            image_url: image_url || '',
            category: category || 'Category not available',
            variants,
            weight,
            delivery_info: deliveryInfo,
            additional_features: features,
            additional_images: additionalImages
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