# E-commerce Product Scraper API

A Node.js API for extracting product details from e-commerce websites. This API provides a simple way to fetch standardized product information from Flipkart, Amazon India, and Myntra.

## Features

- Single endpoint for scraping product details
- Support for major Indian e-commerce platforms (Flipkart, Amazon India, Myntra)
- Returns structured product data (title, price, availability, description, image URL)
- Built-in rate limiting to prevent abuse
- Robust error handling
- Modular architecture for maintainability

## Installation

1. Clone the repository:
```
git clone https://github.com/yourusername/ecommerce-product-scraper.git
cd ecommerce-product-scraper
```

2. Install dependencies:
```
npm install
```

3. Start the server:
```
npm start
```

For development with auto-reload:
```
npm run dev
```

## API Usage

### Get Product Details

**Endpoint:** `GET /product`

**Query Parameters:**
- `url` (required): Full URL of the product page from a supported website

**Example Request:**
```
GET http://localhost:3000/product?url=https://www.flipkart.com/product-page
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "title": "Product Name",
    "price": "₹1,999",
    "availability": "In Stock",
    "description": "Product description text...",
    "image_url": "https://example.com/image.jpg"
  }
}
```

**Error Responses:**

- Invalid URL:
```json
{
  "success": false,
  "message": "Invalid URL format"
}
```

- Unsupported Website:
```json
{
  "success": false,
  "message": "URL is not from a supported website. Supported websites: Flipkart, Amazon India, Myntra"
}
```

- Product Not Found:
```json
{
  "success": false,
  "message": "Product details not found"
}
```

## Project Structure

```
├── server.js              # Main entry point
├── package.json           # Project dependencies
├── routes/
│   └── product.js         # Product routes
├── middleware/
│   ├── errorHandler.js    # Global error handling
│   └── validators.js      # Request validation
├── services/
│   ├── scraper.js         # Main scraper service
│   └── websiteScrapers.js # Website-specific scrapers
└── tests/
    └── scraper.test.js    # Unit tests
```

## Testing

Run the test suite:
```
npm test
```

## Limitations

- Website structure changes may break the scraper
- Does not handle JavaScript-rendered content (SPA websites)
- Rate limiting may be required on a per-website basis
- Some websites may block scraping attempts

## License

MIT 