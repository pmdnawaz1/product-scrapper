// tests/scraper.test.js - Unit tests for the scraper service
const { scrapeProduct, ScraperError } = require('../services/scraper');
const axios = require('axios');
const cheerio = require('cheerio');

// Mock dependencies
jest.mock('axios');
jest.mock('../services/websiteScrapers', () => ({
    flipkartScraper: jest.fn(),
    amazonScraper: jest.fn(),
    myntraScraper: jest.fn()
}));

const websiteScrapers = require('../services/websiteScrapers');

describe('Scraper Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should use the correct scraper based on URL - Flipkart', async () => {
        // Setup
        const mockHtml = '<html><body>Test</body></html>';
        const mockProduct = {
            title: 'Test Product',
            price: '₹999',
            availability: 'In Stock',
            description: 'Test description',
            image_url: 'https://example.com/image.jpg'
        };

        axios.create = jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
                status: 200,
                data: mockHtml
            })
        });

        websiteScrapers.flipkartScraper.mockReturnValue(mockProduct);

        // Execute
        const result = await scrapeProduct('https://www.flipkart.com/product');

        // Assert
        expect(websiteScrapers.flipkartScraper).toHaveBeenCalled();
        expect(websiteScrapers.amazonScraper).not.toHaveBeenCalled();
        expect(websiteScrapers.myntraScraper).not.toHaveBeenCalled();
        expect(result).toEqual(mockProduct);
    });

    it('should use the correct scraper based on URL - Amazon', async () => {
        // Setup
        const mockHtml = '<html><body>Test</body></html>';
        const mockProduct = {
            title: 'Test Product',
            price: '₹999',
            availability: 'In Stock',
            description: 'Test description',
            image_url: 'https://example.com/image.jpg'
        };

        axios.create = jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
                status: 200,
                data: mockHtml
            })
        });

        websiteScrapers.amazonScraper.mockReturnValue(mockProduct);

        // Execute
        const result = await scrapeProduct('https://www.amazon.in/product');

        // Assert
        expect(websiteScrapers.flipkartScraper).not.toHaveBeenCalled();
        expect(websiteScrapers.amazonScraper).toHaveBeenCalled();
        expect(websiteScrapers.myntraScraper).not.toHaveBeenCalled();
        expect(result).toEqual(mockProduct);
    });

    it('should handle HTTP errors correctly', async () => {
        // Setup
        axios.create = jest.fn().mockReturnValue({
            get: jest.fn().mockRejectedValue({
                response: {
                    status: 404,
                    statusText: 'Not Found'
                },
                message: 'Request failed with status code 404'
            })
        });

        // Execute & Assert
        await expect(scrapeProduct('https://www.flipkart.com/nonexistent'))
            .rejects
            .toThrow(ScraperError);
    });

    it('should validate scraped data for missing fields', async () => {
        // Setup
        const mockHtml = '<html><body>Test</body></html>';
        const incompleteProduct = {
            title: 'Test Product',
            price: '₹999',
            // Missing availability
            description: 'Test description',
            // Missing image_url
        };

        axios.create = jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
                status: 200,
                data: mockHtml
            })
        });

        websiteScrapers.flipkartScraper.mockReturnValue(incompleteProduct);

        // Execute & Assert
        await expect(scrapeProduct('https://www.flipkart.com/product'))
            .rejects
            .toThrow(/Missing fields/);
    });
});