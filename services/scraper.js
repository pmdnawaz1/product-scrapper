// services/scraper.js - Main service for scraping product data with AI integration
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

// Initialize Gemini AI client
const genAI = new GoogleGenerativeAI(config.geminiApiKey);

// Cache directory
const CACHE_DIR = path.join(__dirname, '../cache');

// Error class for scraper-specific errors
class ScraperError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'ScraperError';
    this.statusCode = statusCode;
  }
}

/**
 * Utility function for pausing execution
 * @param {object} page - Puppeteer page object
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
async function wait(page, ms) {
  // Use waitFor for older Puppeteer versions, waitForTimeout for newer ones
  if (typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(ms);
  } else if (typeof page.waitFor === 'function') {
    await page.waitFor(ms);
  } else {
    // Fallback to setTimeout if neither method is available
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Detect e-commerce platform from URL
 * @param {string} url - Product page URL
 * @returns {string} Platform name
 */
function detectPlatform(url) {
  if (url.includes('amazon.in') || url.includes('amzn.in')) return 'amazon';
  if (url.includes('flipkart.com')) return 'flipkart';
  if (url.includes('myntra.com')) return 'myntra';
  if (url.includes('snapdeal.com')) return 'snapdeal';
  throw new ScraperError('Unsupported platform', 400);
}

/**
 * Create inverted index for finding elements on the page
 * @param {object} page - Puppeteer page object
 * @returns {Promise<object>} Inverted index of page elements
 */
async function createInvertedIndex(page) {
  try {
    return await page.evaluate(() => {
      const index = {
        textContent: {},  // Map text content to elements
        attributes: {},   // Map attribute values to elements
        tagNames: {},     // Group elements by tag name
        classes: {},      // Map class names to elements
        hierarchy: {}     // Map hierarchical positions to elements
      };
      
      // Helper function to add to index
      const addToIndex = (key, value, indexType) => {
        if (!index[indexType][key]) {
          index[indexType][key] = [];
        }
        if (!index[indexType][key].includes(value)) {
          index[indexType][key].push(value);
        }
      };
      
      // Create XPath for element
      const getXPath = (element) => {
        if (!element) return null;
        if (element === document.body) return '/html/body';
        
        let path = '';
        let current = element;
        
        while (current !== document.body && current.parentElement) {
          const siblings = Array.from(current.parentElement.children);
          const tagSiblings = siblings.filter(e => e.tagName === current.tagName);
          const index = tagSiblings.indexOf(current) + 1;
          
          const tagName = current.tagName.toLowerCase();
          path = `/${tagName}[${index}]${path}`;
          current = current.parentElement;
        }
        
        return `/html/body${path}`;
      };
      
      // Process all visible elements
      const processElement = (element) => {
        // Skip hidden elements
        if (element.offsetParent === null && element.tagName !== 'BODY') return;
        
        // Get XPath
        const xpath = getXPath(element);
        if (!xpath) return;
        
        // Add text content to index
        const text = element.textContent?.trim();
        if (text && text.length > 0 && text.length < 200) {
          addToIndex(text.toLowerCase(), xpath, 'textContent');
          
          // Also index partial text for fuzzy matching
          if (text.length > 10) {
            for (let i = 0; i < text.length - 5; i += 5) {
              const subtext = text.substring(i, i + 10).toLowerCase();
              addToIndex(subtext, xpath, 'textContent');
            }
          }
        }
        
        // Add tag name to index
        const tagName = element.tagName.toLowerCase();
        addToIndex(tagName, xpath, 'tagNames');
        
        // Add classes to index
        if (element.classList && element.classList.length > 0) {
          Array.from(element.classList).forEach(className => {
            addToIndex(className, xpath, 'classes');
          });
        }
        
        // Add attributes to index
        Array.from(element.attributes).forEach(attr => {
          if (attr.value && attr.value.trim().length > 0) {
            addToIndex(`${attr.name}=${attr.value}`, xpath, 'attributes');
            
            // Special case for common attributes
            if (['id', 'name', 'placeholder', 'title', 'alt'].includes(attr.name)) {
              addToIndex(attr.value.toLowerCase(), xpath, 'attributes');
            }
          }
        });
        
        // Add to hierarchy index
        const parent = element.parentElement;
        if (parent) {
          const parentXPath = getXPath(parent);
          if (parentXPath) {
            if (!index.hierarchy[parentXPath]) {
              index.hierarchy[parentXPath] = [];
            }
            index.hierarchy[parentXPath].push(xpath);
          }
        }
        
        // Process children
        Array.from(element.children).forEach(processElement);
      };
      
      // Start indexing from body
      processElement(document.body);
      console.log('Inverted index created', index);
      return index;
    });
  } catch (error) {
    console.error('Error creating inverted index:', error);
    return null;
  }
}

/**
 * Handle platform-specific challenges and obstacles
 * @param {object} page - Puppeteer page object
 * @param {string} platform - E-commerce platform name
 * @returns {Promise<void>}
 */
async function handlePlatformObstacles(page, platform) {
  console.log(`Handling obstacles for ${platform}`);
  
  try {
    // First try with generic approaches without AI
    await page.evaluate((platform) => {
      // Generic close button finder
      const closeButtons = Array.from(document.querySelectorAll('button, [role="button"], div'))
        .filter(el => {
          const text = el.textContent.toLowerCase().trim();
          const hasXSymbol = text === 'x' || text === '×' || text === '✕';
          const isCloseText = text === 'close' || text === 'cancel';
          const hasCloseText = text.includes('close') || text.includes('dismiss') || text.includes('skip');
          
          // Check if it looks like a close button
          return hasXSymbol || isCloseText || hasCloseText;
        });
      
      // Click all potential close buttons
      closeButtons.forEach(btn => {
        console.log('Clicking potential close button');
        btn.click();
      });
      
      // Platform-specific handling without hardcoded selectors
      if (platform === 'flipkart') {
        // Look for login dialogs or popups
        const loginElements = Array.from(document.querySelectorAll('*'))
          .filter(el => {
            const text = el.textContent.toLowerCase().trim();
            return text.includes('login') || text.includes('sign in') || text.includes('log in');
          });
        
        // If found, look for close buttons nearby
        loginElements.forEach(el => {
          // Find close buttons in parent or nearby
          const parent = el.closest('div[role="dialog"]') || el.closest('div.modal') || el.parentElement;
          if (parent) {
            const closeBtn = Array.from(parent.querySelectorAll('button'))
              .find(btn => btn.textContent.trim() === '✕' || btn.textContent.trim() === '×');
            if (closeBtn) closeBtn.click();
          }
        });
      }
      
      if (platform === 'myntra') {
        // Look for newsletter popups
        const newsElements = Array.from(document.querySelectorAll('*'))
          .filter(el => {
            const text = el.textContent.toLowerCase().trim();
            return text.includes('newsletter') || text.includes('subscribe') || text.includes('join us');
          });
        
        // If found, look for close buttons nearby
        newsElements.forEach(el => {
          const parent = el.closest('div.modal') || el.closest('div.popup') || el.parentElement;
          if (parent) {
            const closeBtn = Array.from(parent.querySelectorAll('button, span, div'))
              .find(btn => btn.textContent.trim() === '✕' || btn.textContent.trim() === '×' || btn.textContent.toLowerCase().includes('close'));
            if (closeBtn) closeBtn.click();
          }
        });
      }
      
    }, platform);
    
    // Wait a bit for any changes
    await wait(page, 1000);
    
    // Additional handling for specific platforms
    if (platform === 'amazon') {
      // Check for captcha
      const captchaDetected = await page.evaluate(() => {
        return document.body.textContent.includes('Enter the characters you see below') ||
               document.body.textContent.includes('Type the characters you see');
      });
      
      if (captchaDetected) {
        console.log('⚠️ Captcha detected on Amazon. Waiting for resolution...');
        // Use a compatible way to wait
        try {
          if (typeof page.waitForNavigation === 'function') {
            await page.waitForNavigation({ timeout: 30000 }).catch(() => {});
          } else {
            await wait(page, 30000);
          }
        } catch (e) {
          console.log('Wait for captcha resolution timed out');
        }
      }
    }
  } catch (error) {
    console.error(`Error handling obstacles for ${platform}:`, error);
    // Just continue, as this is not critical
  }
}

/**
 * Extract structured product data using AI
 * @param {object} page - Puppeteer page object
 * @param {string} platform - E-commerce platform name
 * @returns {Promise<object>} Structured product data
 */

async function extractDataWithAI(page, platform) {
  try {
    // Capture entire page content
    const pageContent = await page.content();

    // Take a screenshot for visual analysis
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const screenshotBase64 = screenshotBuffer.toString("base64");

    // Use Gemini to analyze the page and extract structured data
    const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      Extract complete product information from this ${platform} product page. 
      Identify the following information without missing any details:
      1. Product title (full title)
      2. Current price (with currency)
      3. Original price if available (with currency)
      4. Complete product description
      5. All features/specifications
      6. All available variants (colors, sizes, etc.)
      7. All product images URLs (make sure to get full-sized images, not thumbnails)
      8. Delivery information
      9. Weight information (if available) - this is especially important, search thoroughly for weight
      10. Product category
      
      Return the data as a valid JSON object with these fields:
      {
        "title": "string",
        "price": "string",
        "originalPrice": "string or null",
        "description": "string",
        "features": ["array of strings"],
        "variants": {
          "sizes": ["array of available sizes"],
          "colors": ["array of available colors"],
          "other": ["any other variant types"]
        },
        "images": ["array of image URLs"],
        "delivery": {
          "available": "boolean",
          "estimatedDate": "string or null",
          "pincode": "string or null"
        },
        "weight": "string or null",
        "category": "string"
      }
      
      IMPORTANT: DO NOT include comments or explanations in your JSON. Make sure your JSON is valid and properly formatted.
      If any information is missing, include the field with a null value.
      Pay special attention to finding the weight information and full-sized product images - these are critical.
    `;

    try {
      const result = await geminiModel.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: { mimeType: "image/jpeg", data: screenshotBase64 },
              },
            ],
          },
        ],
      });

      const responseText = result.response.text();

      // More robust JSON extraction that handles both code blocks and direct JSON
      let jsonText = responseText;

      // Try to extract JSON from code blocks if present
      const jsonBlockMatch = responseText.match(
        /```(?:json)?\s*([\s\S]*?)\s*```/
      );
      if (jsonBlockMatch && jsonBlockMatch[1]) {
        jsonText = jsonBlockMatch[1];
      } else {
        // Or try to extract JSON object directly
        const jsonObjectMatch = responseText.match(/(\{[\s\S]*\})/);
        if (jsonObjectMatch && jsonObjectMatch[1]) {
          jsonText = jsonObjectMatch[1];
        }
      }

      // Clean up the JSON text by removing comments and fixing common issues
      jsonText = jsonText
        .replace(/\/\/.*$/gm, "") // Remove single line comments
        .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
        .replace(/,\s*}/g, "}") // Remove trailing commas in objects
        .replace(/,\s*]/g, "]"); // Remove trailing commas in arrays

      try {
        const parsedData = JSON.parse(jsonText);
        return {
          ...parsedData,
          source: platform,
        };
      } catch (jsonError) {
        console.error("JSON parse error:", jsonError);
        console.log("Attempting to sanitize JSON further...");

        // More aggressive JSON fixing for severe formatting issues
        const minimalJsonText = jsonText
          .replace(/[\r\n\t]/g, " ") // Replace newlines and tabs with spaces
          .replace(/\s+/g, " ") // Normalize whitespace
          .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":') // Ensure property names are quoted
          .replace(/:\s*'/g, ':"') // Replace single quotes with double quotes for values
          .replace(/'\s*,/g, '",') // Replace single quotes with double quotes for values
          .replace(/'\s*}/g, '"}') // Replace single quotes with double quotes for values
          .replace(/'\s*]/g, '"]') // Replace single quotes with double quotes for values
          .replace(/:\s*([^",\{\[\]\}]+)(\s*[,\}\]])/g, ':"$1"$2'); // Quote unquoted string values

        // Try parsing again
        try {
          const parsedData = JSON.parse(minimalJsonText);
          return {
            ...parsedData,
            source: platform,
          };
        } catch (minimalJsonError) {
          console.error("Minimal JSON parse also failed:", minimalJsonError);
          throw new Error("Unable to parse JSON response from AI");
        }
      }
    } catch (aiError) {
      console.error("Error with Gemini AI call:", aiError);
      // Try with a different model or format if available
      try {
        // Simplified prompt without image for text-only models
        const textOnlyModel = genAI.getGenerativeModel({
          model: "gemini-1.5-flash",
        });
        const textResult = await textOnlyModel.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Extract product data from this HTML as valid JSON without comments. Return ONLY valid JSON: ${pageContent.substring(
                    0,
                    20000
                  )}`,
                },
              ],
            },
          ],
        });

        const textResponseText = textResult.response.text();

        // Apply the same JSON extraction and cleaning logic
        let textJsonText = textResponseText;

        const textJsonBlockMatch = textResponseText.match(
          /```(?:json)?\s*([\s\S]*?)\s*```/
        );
        if (textJsonBlockMatch && textJsonBlockMatch[1]) {
          textJsonText = textJsonBlockMatch[1];
        } else {
          const textJsonObjectMatch = textResponseText.match(/(\{[\s\S]*\})/);
          if (textJsonObjectMatch && textJsonObjectMatch[1]) {
            textJsonText = textJsonObjectMatch[1];
          }
        }

        textJsonText = textJsonText
          .replace(/\/\/.*$/gm, "")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/,\s*}/g, "}")
          .replace(/,\s*]/g, "]");

        try {
          const parsedData = JSON.parse(textJsonText);
          return {
            ...parsedData,
            source: platform,
          };
        } catch (textJsonError) {
          console.error("Text JSON parse error:", textJsonError);
          throw new Error("Unable to parse JSON from text-only response");
        }
      } catch (textAiError) {
        console.error("Text-only AI model also failed:", textAiError);
        throw new Error("All AI parsing methods failed");
      }
    }
  } catch (error) {
    console.error("Error extracting data with AI:", error);
    // Fall back to basic extraction
    return await fallbackExtraction(page, platform);
  }
}
/**
 * Extract data using inverted index with AI assistance
 * @param {object} page - Puppeteer page object
 * @param {string} platform - E-commerce platform name
 * @param {object} pageIndex - Inverted index of page elements
 * @returns {Promise<object>} Structured product data
 */
async function extractDataWithIndexAndAI(page, platform, pageIndex) {
  console.log(`Extracting data from ${platform} using inverted index and AI`);
  
  try {
    // First try to extract basic data using inverted index
    const basicData = await extractBasicDataWithIndex(page, pageIndex);
    
    // If we have most of the data, return it
    if (basicData.title && basicData.price && basicData.description && basicData.images?.length > 0) {
      console.log('Successfully extracted data using inverted index');
      return { ...basicData, source: platform };
    }
    
    // If we're missing critical data, use full AI extraction
    console.log('Inverted index extraction incomplete, using AI vision');
    
    // Fall back to AI extraction
    const aiData = await extractDataWithAI(page, platform);
    
    // Merge the data, preferring AI data for missing fields
    const mergedData = {
      ...basicData,
      ...aiData,
      source: platform,
      // Merge arrays and objects
      images: [...(basicData.images || []), ...(aiData.images || [])].filter((v, i, a) => a.indexOf(v) === i),
      features: [...(basicData.features || []), ...(aiData.features || [])].filter((v, i, a) => a.indexOf(v) === i),
      variants: {
        ...(basicData.variants || {}),
        ...(aiData.variants || {})
      }
    };
    
    return mergedData;
  } catch (error) {
    console.error('Error in data extraction with index and AI:', error);
    // Try AI extraction directly
    try {
      return await extractDataWithAI(page, platform);
    } catch (aiError) {
      console.error('AI extraction also failed:', aiError);
      // Last resort: use basic fallback extraction
      return await fallbackExtraction(page, platform);
    }
  }
}

/**
 * Extract basic product data using inverted index
 * @param {object} page - Puppeteer page object
 * @param {object} pageIndex - Inverted index of page elements
 * @returns {Promise<object>} Basic product data
 */
async function extractBasicDataWithIndex(page, pageIndex) {
  const data = {
    title: null,
    price: null,
    originalPrice: null,
    description: null,
    features: [],
    images: [],
    variants: {
      sizes: [],
      colors: [],
      other: []
    },
    delivery: {
      available: null,
      estimatedDate: null,
      charges: null
    },
    weight: null,
    category: null
  };
  
  try {
    // Extract data using the inverted index
    await page.evaluate((data, index) => {
      // Helper to get element by xpath
      const getElementByXPath = (xpath) => {
        return document.evaluate(
          xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        ).singleNodeValue;
      };
      
      // Helper to get elements that likely match target
      const findPotentialElements = (targetType) => {
        const potentialElements = [];
        
        // Try to find elements by tag indicators
        if (index.tagNames) {
          // Headings might contain title
          if (targetType === 'title') {
            ['h1', 'h2'].forEach(tag => {
              if (index.tagNames[tag]) {
                index.tagNames[tag].forEach(xpath => {
                  const element = getElementByXPath(xpath);
                  if (element) {
                    potentialElements.push({
                      element,
                      xpath,
                      score: tag === 'h1' ? 5 : 3,
                      text: element.textContent.trim()
                    });
                  }
                });
              }
            });
          }
          
          // Price elements
          if (targetType === 'price') {
            ['span', 'div', 'p'].forEach(tag => {
              if (index.tagNames[tag]) {
                index.tagNames[tag].forEach(xpath => {
                  const element = getElementByXPath(xpath);
                  if (element) {
                    const text = element.textContent.trim();
                    // Look for currency symbols or patterns
                    if (/₹|RS\.|\$|€|£|\d+,\d+/.test(text)) {
                      potentialElements.push({
                        element,
                        xpath,
                        score: 3,
                        text
                      });
                    }
                  }
                });
              }
            });
          }
          
          // Description elements
          if (targetType === 'description') {
            ['div', 'p', 'section'].forEach(tag => {
              if (index.tagNames[tag]) {
                index.tagNames[tag].forEach(xpath => {
                  const element = getElementByXPath(xpath);
                  if (element) {
                    const text = element.textContent.trim();
                    // Look for longer text blocks
                    if (text.length > 50 && text.split(' ').length > 15) {
                      potentialElements.push({
                        element,
                        xpath,
                        score: 2,
                        text
                      });
                    }
                  }
                });
              }
            });
          }
          
          // Image elements - IMPROVED for finding full-sized images
          if (targetType === 'images') {
            if (index.tagNames['img']) {
              index.tagNames['img'].forEach(xpath => {
                const element = getElementByXPath(xpath);
                if (element && element.src) {
                  // Skip tiny images, icons, logos
                  const width = element.width || 0;
                  const height = element.height || 0;
                  const size = width * height;
                  
                  // Skip data URLs/base64 images (usually icons)
                  if (element.src.startsWith('data:')) {
                    return;
                  }
                  
                  // Look for product image indicators in URL or parent elements
                  const isLikelyProductImage = 
                    element.src.includes('product') || 
                    element.src.includes('image') || 
                    element.src.includes('large') || 
                    element.src.includes('zoom') ||
                    element.parentElement?.id?.includes('product') ||
                    element.parentElement?.className?.includes('product');
                  
                  // Get higher-res version if available
                  let bestSrc = element.src;
                  
                  // Check for data-zoom-image or other high-res attributes
                  if (element.dataset.zoomImage) {
                    bestSrc = element.dataset.zoomImage;
                  } else if (element.dataset.zoom) {
                    bestSrc = element.dataset.zoom;
                  } else if (element.dataset.largeImage) {
                    bestSrc = element.dataset.largeImage;
                  } else if (element.srcset) {
                    // Parse srcset to get largest image
                    const srcset = element.srcset.split(',');
                    let maxWidth = 0;
                    srcset.forEach(src => {
                      const parts = src.trim().split(' ');
                      if (parts.length >= 2) {
                        const width = parseInt(parts[1].replace('w', ''));
                        if (width > maxWidth) {
                          maxWidth = width;
                          bestSrc = parts[0];
                        }
                      }
                    });
                  }
                  
                  // Score based on size, location and likelihood of being product image
                  let score = 0;
                  
                  // Score based on image size
                  if (size > 40000) score += 5;      // Very large image
                  else if (size > 20000) score += 3; // Medium-large image
                  else if (size > 10000) score += 2; // Medium image
                  else score += 1;                   // Small image
                  
                  // Bonus for likely product images
                  if (isLikelyProductImage) score += 3;
                  
                  // Bonus for images in product containers
                  const closestProductDiv = element.closest('div[id*="product"], div[class*="product"]');
                  if (closestProductDiv) score += 2;
                  
                  potentialElements.push({
                    element,
                    xpath,
                    score,
                    url: bestSrc.trim()
                  });
                }
              });
            }
          }
          
          // NEW: Weight extraction specific targeting
          if (targetType === 'weight') {
            // Look for elements likely containing weight information
            ['span', 'div', 'p', 'li', 'td'].forEach(tag => {
              if (index.tagNames[tag]) {
                index.tagNames[tag].forEach(xpath => {
                  const element = getElementByXPath(xpath);
                  if (element) {
                    const text = element.textContent.trim().toLowerCase();
                    
                    // Check for weight indicators in text
                    if (text.includes('weight') || 
                        text.includes('kg') || 
                        text.includes('gram') || 
                        text.includes('oz') || 
                        text.includes('pound') || 
                        text.includes('lb') ||
                        /\d+\s*(g|kg|gram|lb|oz|pound)/.test(text)) {
                          
                      // Try to extract the weight value using regex
                      const weightMatches = text.match(/(\d+(?:\.\d+)?)\s*(g|gram|kg|kilogram|lb|oz|pound)/i);
                      const isWeightCell = text === 'weight' || text === 'item weight';
                      
                      if (weightMatches || isWeightCell) {
                        let score = 4;
                        let weightValue = null;
                        
                        if (weightMatches) {
                          weightValue = text;
                          score = 6;
                        } else if (isWeightCell) {
                          // If this is a label cell, look for next cell which might contain the value
                          const parent = element.parentElement;
                          const nextCell = parent?.nextElementSibling || parent?.nextSibling;
                          if (nextCell && nextCell.textContent) {
                            weightValue = nextCell.textContent.trim();
                            score = 5;
                          } else {
                            // Check if it's in a table structure
                            const row = element.closest('tr');
                            if (row) {
                              const valueCell = row.querySelector('td:nth-child(2)');
                              if (valueCell) {
                                weightValue = valueCell.textContent.trim();
                                score = 5;
                              }
                            }
                          }
                        }
                        
                        potentialElements.push({
                          element,
                          xpath,
                          score,
                          text: weightValue || text
                        });
                      }
                    }
                  }
                });
              }
            });
            
            // Also look for weight in specs tables
            const specsTables = document.querySelectorAll('table, dl, div[class*="spec"], div[class*="detail"]');
            Array.from(specsTables).forEach(table => {
              // For tables
              if (table.tagName === 'TABLE') {
                const rows = table.querySelectorAll('tr');
                Array.from(rows).forEach(row => {
                  const cells = row.querySelectorAll('td, th');
                  if (cells.length >= 2) {
                    const labelCell = cells[0];
                    const valueCell = cells[1];
                    
                    if (labelCell && valueCell && 
                        (labelCell.textContent.toLowerCase().includes('weight') ||
                         labelCell.textContent.toLowerCase().includes('kg') ||
                         labelCell.textContent.toLowerCase().includes('gram'))) {
                      
                      potentialElements.push({
                        element: valueCell,
                        xpath: null,
                        score: 7, // Higher score for table matches
                        text: valueCell.textContent.trim()
                      });
                    }
                  }
                });
              }
              
              // For definition lists
              if (table.tagName === 'DL') {
                const terms = table.querySelectorAll('dt');
                Array.from(terms).forEach(term => {
                  if (term.textContent.toLowerCase().includes('weight')) {
                    const desc = term.nextElementSibling;
                    if (desc && desc.tagName === 'DD') {
                      potentialElements.push({
                        element: desc,
                        xpath: null,
                        score: 7,
                        text: desc.textContent.trim()
                      });
                    }
                  }
                });
              }
              
              // For div-based spec tables
              if (table.tagName === 'DIV') {
                const labels = table.querySelectorAll('div[class*="label"], span[class*="label"], div[class*="key"], span[class*="key"]');
                Array.from(labels).forEach(label => {
                  if (label.textContent.toLowerCase().includes('weight')) {
                    const parent = label.parentElement;
                    if (parent) {
                      const valueElem = parent.querySelector('div[class*="value"], span[class*="value"]');
                      if (valueElem) {
                        potentialElements.push({
                          element: valueElem,
                          xpath: null,
                          score: 7,
                          text: valueElem.textContent.trim()
                        });
                      }
                    }
                  }
                });
              }
            });
          }
        }
        
        // Look for text that indicates a specific element type
        if (index.textContent) {
          if (targetType === 'price') {
            // Terms that suggest price
            ['price', 'mrp', 'discount', 'offer', 'deal', 'sale'].forEach(term => {
              Object.keys(index.textContent).forEach(text => {
                if (text.toLowerCase().includes(term)) {
                  index.textContent[text].forEach(xpath => {
                    const element = getElementByXPath(xpath);
                    if (element) {
                      // Get parent or nearby elements that might contain the price
                      const parent = element.parentElement;
                      if (parent) {
                        const priceElements = parent.querySelectorAll('*');
                        Array.from(priceElements).forEach(el => {
                          const elText = el.textContent.trim();
                          // Look for currency symbols or price patterns
                          if (/₹|RS\.|\$|€|£|\d+,\d+/.test(elText)) {
                            potentialElements.push({
                              element: el,
                              xpath, // Using the original xpath as reference
                              score: 4,
                              text: elText
                            });
                          }
                        });
                      }
                    }
                  });
                }
              });
            });
          }
          
          // For description, look for section indicators
          if (targetType === 'description') {
            ['description', 'about', 'overview', 'details', 'product info', 'specifications'].forEach(term => {
              Object.keys(index.textContent).forEach(text => {
                if (text.toLowerCase().includes(term)) {
                  index.textContent[text].forEach(xpath => {
                    const element = getElementByXPath(xpath);
                    if (element) {
                      // Get parent or next sibling elements that might contain the description
                      const parent = element.parentElement;
                      if (parent) {
                        const descSections = parent.querySelectorAll('div, p, section, span');
                        Array.from(descSections).forEach(el => {
                          const elText = el.textContent.trim();
                          // Look for longer text blocks
                          if (elText.length > 50 && elText.split(' ').length > 15 && !elText.includes(text)) {
                            potentialElements.push({
                              element: el,
                              xpath, // Using the original xpath as reference
                              score: 4,
                              text: elText
                            });
                          }
                        });
                      }
                    }
                  });
                }
              });
            });
          }
          
          // NEW: Look for weight-related labels specifically
          if (targetType === 'weight') {
            ['weight', 'net quantity', 'item weight', 'product weight', 'shipping weight'].forEach(term => {
              Object.keys(index.textContent).forEach(text => {
                if (text.toLowerCase().includes(term)) {
                  index.textContent[text].forEach(xpath => {
                    const element = getElementByXPath(xpath);
                    if (element) {
                      // Check if the text itself contains weight info
                      const fullText = element.textContent.trim();
                      if (/\d+(\.\d+)?\s*(kg|g|gram|lb|oz|pound)/i.test(fullText)) {
                        potentialElements.push({
                          element,
                          xpath,
                          score: 6,
                          text: fullText
                        });
                      } else {
                        // Get parent element that might contain the weight
                        const parent = element.parentElement;
                        if (parent) {
                          // Look for siblings with weight values
                          const siblings = parent.querySelectorAll('*');
                          Array.from(siblings).forEach(sib => {
                            if (sib !== element) {
                              const sibText = sib.textContent.trim();
                              if (/\d+(\.\d+)?\s*(kg|g|gram|lb|oz|pound)/i.test(sibText)) {
                                potentialElements.push({
                                  element: sib,
                                  xpath,
                                  score: 5,
                                  text: sibText
                                });
                              }
                            }
                          });
                          
                          // Check in nearby table rows or list items
                          const nearbyRows = parent.closest('table')?.querySelectorAll('tr');
                          if (nearbyRows) {
                            Array.from(nearbyRows).forEach(row => {
                              const cells = row.querySelectorAll('td, th');
                              if (cells.length >= 2) {
                                const label = cells[0]?.textContent.toLowerCase();
                                if (label && label.includes('weight')) {
                                  potentialElements.push({
                                    element: cells[1],
                                    xpath,
                                    score: 6,
                                    text: cells[1].textContent.trim()
                                  });
                                }
                              }
                            });
                          }
                        }
                      }
                    }
                  });
                }
              });
            });
          }
        }
        
        return potentialElements;
      };
      
      // Find the best candidate for each data type
      const findBestCandidate = (candidates) => {
        if (!candidates || candidates.length === 0) return null;
        
        // Sort by score
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0];
      };
      
      // Extract title
      const titleCandidates = findPotentialElements('title');
      const bestTitle = findBestCandidate(titleCandidates);
      if (bestTitle) {
        data.title = bestTitle.text;
      }
      
      // Extract price
      const priceCandidates = findPotentialElements('price');
      const bestPrice = findBestCandidate(priceCandidates);
      if (bestPrice) {
        data.price = bestPrice.text;
        
        // Look for original price (often near the current price)
        if (bestPrice.element) {
          const parent = bestPrice.element.parentElement || document;
          const priceTexts = Array.from(parent.querySelectorAll('*'))
            .map(el => el.textContent.trim())
            .filter(text => /₹|RS\.|\$|€|£|\d+,\d+/.test(text))
            .filter(text => text !== bestPrice.text);
          
          if (priceTexts.length > 0) {
            data.originalPrice = priceTexts[0];
          }
        }
      }
      
      // Extract description
      const descCandidates = findPotentialElements('description');
      const bestDesc = findBestCandidate(descCandidates);
      if (bestDesc) {
        data.description = bestDesc.text;
      }
      
      // Extract images with improved accuracy
      const imageCandidates = findPotentialElements('images');
      imageCandidates.sort((a, b) => b.score - a.score);
      
      // Take the top 5 unique image URLs
      const uniqueImageUrls = new Set();
      const topImages = [];
      
      for (const img of imageCandidates) {
        // Normalize the URL to handle relative paths
        let fullUrl = img.url;
        
        // Handle relative URLs
        if (fullUrl && !fullUrl.startsWith('http') && !fullUrl.startsWith('data:')) {
          if (fullUrl.startsWith('//')) {
            fullUrl = 'https:' + fullUrl;
          } else if (fullUrl.startsWith('/')) {
            fullUrl = window.location.origin + fullUrl;
          } else {
            fullUrl = window.location.origin + '/' + fullUrl;
          }
        }
        
        // Filter out thumbnail indicators in URLs
        if (fullUrl && 
            !fullUrl.includes('thumb') && 
            !fullUrl.includes('icon') && 
            !fullUrl.includes('logo') && 
            !fullUrl.startsWith('data:')) {
          
          // Clean up the URL
          fullUrl = fullUrl.split('?')[0]; // Remove query parameters
          
          // Add to unique set
          if (!uniqueImageUrls.has(fullUrl)) {
            uniqueImageUrls.add(fullUrl);
            topImages.push(fullUrl);
            
            // Break after finding 5 unique images
            if (topImages.length >= 5) break;
          }
        }
      }
      
      data.images = topImages;
      
      // NEW: Extract weight information
      const weightCandidates = findPotentialElements('weight');
      const bestWeight = findBestCandidate(weightCandidates);
      if (bestWeight) {
        data.weight = bestWeight.text;
      }
      
      // Extract features if available
      if (bestDesc && bestDesc.element) {
        const listElements = Array.from(document.querySelectorAll('ul li, ol li'));
        data.features = listElements
          .map(li => li.textContent.trim())
          .filter(text => text.length > 5 && text.length < 200)
          .slice(0, 10);
      }
      
      // Extract category from breadcrumbs if available
      const breadcrumbs = Array.from(document.querySelectorAll('nav, [aria-label*="bread"], [class*="bread"]'))
        .map(nav => Array.from(nav.querySelectorAll('a')))
        .flat()
        .map(a => a.textContent.trim())
        .filter(text => text.length > 0 && text.length < 50);
      
      if (breadcrumbs.length > 1) {
        // Usually the second breadcrumb is the category
        data.category = breadcrumbs[1];
      }
      
      return data;
    }, data, pageIndex);
    
    return data;
  } catch (error) {
    console.error('Error extracting with inverted index:', error);
    return data;
  }
}

/**
 * Last resort extraction when other methods fail
 * @param {object} page - Puppeteer page object
 * @param {string} platform - E-commerce platform name
 * @returns {Promise<object>} Basic product data
 */
async function fallbackExtraction(page, platform) {
  console.log(`Using fallback extraction for ${platform}`);
  
  // Initialize empty data structure
  const data = {
    title: null,
    price: null,
    originalPrice: null,
    description: null,
    features: [],
    images: [],
    variants: {
      sizes: [],
      colors: [],
      other: []
    },
    delivery: {
      available: null,
      estimatedDate: null,
      charges: null
    },
    weight: null,
    category: null,
    source: platform
  };
  
  try {
    // Extract title using visual heuristics
    data.title = await page.evaluate(() => {
      // Title is likely the largest text in the top part of the page
      const firstThirdOfPage = Math.floor(window.innerHeight / 3);
      
      // Get all text nodes in the top third
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        { acceptNode: node => node.textContent.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT }
      );
      
      const textNodes = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const rect = node.parentElement.getBoundingClientRect();
        
        // Check if element is in the top third and visible
        if (rect.top < firstThirdOfPage && rect.height > 0 && rect.width > 0) {
          const fontSize = parseInt(window.getComputedStyle(node.parentElement).fontSize);
          textNodes.push({
            text: node.textContent.trim(),
            fontSize: fontSize || 12,
            top: rect.top
          });
        }
      }
      
      // Sort by font size (largest first)
      textNodes.sort((a, b) => b.fontSize - a.fontSize);
      
      // The title is likely one of the largest text elements near the top
      return textNodes.length > 0 ? textNodes[0].text : document.title;
    });
    
    // Extract price (looking for currency symbols)
    data.price = await page.evaluate(() => {
      // Find elements with currency symbols
      const priceElements = Array.from(document.querySelectorAll('*'))
        .filter(el => {
          const text = el.textContent.trim();
          return /₹|RS\.|\$|€|£/.test(text) && /\d/.test(text);
        })
        .map(el => ({
          element: el,
          text: el.textContent.trim(),
          fontSize: parseInt(window.getComputedStyle(el).fontSize) || 12
        }));
      
      // Sort by font size (largest first)
      priceElements.sort((a, b) => b.fontSize - a.fontSize);
      
      return priceElements.length > 0 ? priceElements[0].text : null;
    });
    
    // Extract main image with improved approach
    const mainImages = await page.evaluate(() => {
      // Find all images
      const allImages = Array.from(document.querySelectorAll('img'));
      
      // Filter out obvious non-product images
      const productImages = allImages.filter(img => {
        // Must have a src and not be a data URL
        if (!img.src || img.src.startsWith('data:') || img.src.includes('base64')) {
          return false;
        }
        
        // Skip likely non-product images
        if (img.src.includes('logo') || 
            img.src.includes('icon') || 
            img.src.includes('banner') || 
            img.src.includes('payment')) {
          return false;
        }
        
        // Filter by size - product images are usually large
        const width = img.width || 0;
        const height = img.height || 0;
        
        return (width >= 200 && height >= 200) || (width * height >= 40000);
      });
      
      // Assign scores to images for ranking
      const scoredImages = productImages.map(img => {
        let score = 0;
        
        // Size score
        const area = (img.width || 0) * (img.height || 0);
        if (area > 100000) score += 5;
        else if (area > 50000) score += 4;
        else if (area > 30000) score += 3;
        else if (area > 10000) score += 2;
        else score += 1;
        
        // URL score - product images often have certain words in URL
        const url = img.src.toLowerCase();
        if (url.includes('product')) score += 3;
        if (url.includes('large')) score += 2;
        if (url.includes('zoom')) score += 2;
        if (url.includes('full')) score += 2;
        if (url.includes('main')) score += 2;
        
        // Position score - product images often at top of page
        const rect = img.getBoundingClientRect();
        if (rect.top < 500) score += 2;
        
        // Check attributes for high-res versions
        let bestSrc = img.src;
        if (img.dataset.zoom) bestSrc = img.dataset.zoom;
        if (img.dataset.zoomImage) bestSrc = img.dataset.zoomImage;
        if (img.dataset.large) bestSrc = img.dataset.large;
        if (img.dataset.src) bestSrc = img.dataset.src;
        
        // Parse srcset for largest version
        if (img.srcset) {
          const srcset = img.srcset.split(',');
          let largestWidth = 0;
          
          srcset.forEach(srcItem => {
            const parts = srcItem.trim().split(' ');
            if (parts.length >= 2) {
              const widthMatch = parts[1].match(/(\d+)w/);
              if (widthMatch && widthMatch[1]) {
                const width = parseInt(widthMatch[1]);
                if (width > largestWidth) {
                  largestWidth = width;
                  bestSrc = parts[0];
                }
              }
            }
          });
        }
        
        // Check if image is in a product container
        const isInProductContainer = 
          img.closest('div[id*="product"]') || 
          img.closest('div[class*="product"]') ||
          img.closest('div[id*="image"]') || 
          img.closest('div[class*="image"]');
          
        if (isInProductContainer) score += 3;
        
        return {
          src: bestSrc,
          score: score,
          area: area
        };
      });
      
      // Sort by score (highest first)
      scoredImages.sort((a, b) => b.score - a.score || b.area - a.area);
      
      // Return top 5 unique URLs
      const uniqueUrls = new Set();
      const result = [];
      
      for (const img of scoredImages) {
        // Clean up URL
        let fullUrl = img.src;
        
        // Handle relative URLs
        if (!fullUrl.startsWith('http') && !fullUrl.startsWith('data:')) {
          if (fullUrl.startsWith('//')) {
            fullUrl = 'https:' + fullUrl;
          } else if (fullUrl.startsWith('/')) {
            fullUrl = window.location.origin + fullUrl;
          } else {
            fullUrl = window.location.origin + '/' + fullUrl;
          }
        }
        
        // Remove query parameters
        fullUrl = fullUrl.split('?')[0];
        
        if (!uniqueUrls.has(fullUrl)) {
          uniqueUrls.add(fullUrl);
          result.push(fullUrl);
          
          if (result.length >= 5) break;
        }
      }
      
      return result;
    });
    
    if (mainImages && mainImages.length > 0) {
      data.images = mainImages;
    }
    
    // Extract description (looking for large text blocks)
    data.description = await page.evaluate(() => {
      // Find elements with substantial text
      const textBlocks = Array.from(document.querySelectorAll('p, div, section, article'))
        .filter(el => {
          const text = el.textContent.trim();
          return text.length > 100 && text.split(' ').length > 20;
        })
        .map(el => ({
          element: el,
          text: el.textContent.trim(),
          length: el.textContent.trim().length
        }));
      
      // Sort by length (longest first)
      textBlocks.sort((a, b) => b.length - a.length);
      
      return textBlocks.length > 0 ? textBlocks[0].text : null;
    });
    
    // NEW: Extract weight information
    data.weight = await page.evaluate(() => {
      // Look for elements containing weight information
      const weightElements = Array.from(document.querySelectorAll('*'))
        .filter(el => {
          const text = el.textContent.toLowerCase().trim();
          return (text.includes('weight') || 
                  /\d+\s*kg/i.test(text) || 
                  /\d+\s*g\b/i.test(text) || 
                  /\d+\s*gram/i.test(text) || 
                  /\d+\s*lb/i.test(text)) && 
                 text.length < 100;
        });
      
      // Check table cells specifically (often contains specs)
      const tables = document.querySelectorAll('table');
      tables.forEach(table => {
        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
          const cells = row.querySelectorAll('td, th');
          if (cells.length >= 2) {
            const label = cells[0].textContent.toLowerCase().trim();
            if (label.includes('weight')) {
              weightElements.push(cells[1]);
            }
          }
        });
      });
      
      // Check definition lists
      const dls = document.querySelectorAll('dl');
      dls.forEach(dl => {
        const terms = dl.querySelectorAll('dt');
        terms.forEach(term => {
          if (term.textContent.toLowerCase().includes('weight')) {
            const desc = term.nextElementSibling;
            if (desc && desc.tagName === 'DD') {
              weightElements.push(desc);
            }
          }
        });
      });
      
      // Extract the best weight information
      if (weightElements.length > 0) {
        // Try to find the most likely weight value
        for (const el of weightElements) {
          const text = el.textContent.trim();
          // Direct weight pattern (number + unit)
          const weightMatch = text.match(/(\d+(\.\d+)?)\s*(kg|g|gram|lb|oz|pound)/i);
          if (weightMatch) {
            return text;
          }
        }
        
        // If no direct match, return the first element with "weight" in it
        for (const el of weightElements) {
          const text = el.textContent.trim();
          if (text.toLowerCase().includes('weight')) {
            return text;
          }
        }
        
        // Last resort, just return the first weight-related element
        return weightElements[0].textContent.trim();
      }
      
      return null;
    });
    
    return data;
  } catch (error) {
    console.error('Error in fallback extraction:', error);
    return data;
  }
}

/**
 * Use Gemini AI to fill in missing product data
 * @param {object} page - Puppeteer page object
 * @param {object} productData - Partial product data
 * @param {object} pageIndex - Inverted index of page elements
 * @returns {Promise<object>} Completed product data
 */

async function getFlipkartFullSizeImages(page) {
  try {
    return await page.evaluate(() => {
      // Function to clean and normalize image URLs
      const normalizeImageUrl = (url) => {
        if (!url) return null;

        // Remove query parameters that often reduce image size
        let cleanUrl = url.split("?")[0];

        // Specific to Flipkart: replace image size parameters for full size
        if (cleanUrl.includes("image/")) {
          // Common patterns: .../image/312/312/... or .../image/400/400/...
          cleanUrl = cleanUrl.replace(
            /\/image\/\d+\/\d+\//,
            "/image/1500/1500/"
          );
        }

        return cleanUrl;
      };

      const images = [];

      // Method 1: Check for image gallery
      const galleryImages = document.querySelectorAll(
        "div._3GnUWp img, div._2E1FGS img, div._1BweB8 img, ul._3GnUWp li img"
      );
      if (galleryImages && galleryImages.length > 0) {
        for (const img of galleryImages) {
          const src = img.src || img.getAttribute("data-src");
          if (src) {
            const fullSizeUrl = normalizeImageUrl(src);
            if (fullSizeUrl && !images.includes(fullSizeUrl)) {
              images.push(fullSizeUrl);
            }
          }
        }
      }

      // Method 2: Check for main product image
      const mainImage = document.querySelector(
        "div._3kidJX img, div._396QI4 img, img._396cs4"
      );
      if (mainImage) {
        const src = mainImage.src || mainImage.getAttribute("data-src");
        if (src) {
          const fullSizeUrl = normalizeImageUrl(src);
          if (fullSizeUrl && !images.includes(fullSizeUrl)) {
            images.push(fullSizeUrl);
          }
        }
      }

      // Method 3: Look for thumbnails and convert to full size
      const thumbnails = document.querySelectorAll(
        "div._2mLllQ img, div._412B5C img, ul._3GnUWp img"
      );
      if (thumbnails && thumbnails.length > 0) {
        for (const thumb of thumbnails) {
          const src = thumb.src || thumb.getAttribute("data-src");
          if (src) {
            const fullSizeUrl = normalizeImageUrl(src);
            if (fullSizeUrl && !images.includes(fullSizeUrl)) {
              images.push(fullSizeUrl);
            }
          }
        }
      }

      // Method 4: Check for any large images on the page
      const allImages = document.querySelectorAll("img");
      const productImages = Array.from(allImages)
        .filter((img) => {
          const src = img.src || "";
          return (
            src.includes("product") ||
            src.includes("/image/") ||
            src.includes("_image_") ||
            src.includes("_img_")
          );
        })
        .map((img) => normalizeImageUrl(img.src))
        .filter((url) => url && !images.includes(url));

      images.push(...productImages);

      // Return unique images
      return Array.from(new Set(images)).slice(0, 5);
    });
  } catch (error) {
    console.error("Error getting Flipkart full-size images:", error);
    return [];
  }
}

// 9. Update fillMissingDataWithAI for better error handling with JSON parsing

async function fillMissingDataWithAI(page, productData, pageIndex) {
  // Check which critical fields are missing
  const missingFields = [];

  if (!productData.title) missingFields.push("title");
  if (!productData.price) missingFields.push("price");
  if (!productData.description) missingFields.push("description");
  if (!productData.weight) missingFields.push("weight");
  if (!productData.category) missingFields.push("category");
  if (productData.images?.length === 0) missingFields.push("images");

  // If nothing is missing, return as is
  if (missingFields.length === 0) {
    return productData;
  }

  console.log(`Need to fill missing fields: ${missingFields.join(", ")}`);

  try {
    // Platform-specific handling for Flipkart images
    if (productData.source === "flipkart" && missingFields.includes("images")) {
      const flipkartImages = await getFlipkartFullSizeImages(page);
      if (flipkartImages && flipkartImages.length > 0) {
        productData.images = flipkartImages;
        // Remove images from missing fields
        const imageIndex = missingFields.indexOf("images");
        if (imageIndex > -1) {
          missingFields.splice(imageIndex, 1);
        }
      }
    }

    // If we've resolved all missing fields, return early
    if (missingFields.length === 0) {
      return productData;
    }

    // Capture page content and screenshot
    const pageContent = await page.content();
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const screenshotBase64 = screenshotBuffer.toString("base64");

    // Create a prompt for Gemini
    const geminiModel = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
    });

    const prompt = `
    I need your help finding specific missing product information on an e-commerce page.
    
    The page is from ${
      productData.source
    } and I've already extracted some information:
    ${Object.entries(productData)
      .filter(([key, value]) => value && key !== "source")
      .map(
        ([key, value]) =>
          `- ${key}: ${
            typeof value === "object" ? JSON.stringify(value) : value
          }`
      )
      .join("\n")}
    
    I'm missing the following fields: ${missingFields.join(", ")}
    
    For each missing field, tell me exactly where to find it on the page and provide the actual value.
    Pay special attention to weight information - look for it in product specifications, technical details, or shipping information.
    For images, make sure to provide full-size product image URLs, not thumbnails.
    
    Return your answer as a JSON object with ONLY the missing fields.
    Example format:
    {
      "weight": "500g",
      "category": "Electronics"
    }
    
    DO NOT include comments or explanations in your JSON.
  `;

    // Send to Gemini for analysis
    try {
      const result = await geminiModel.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: screenshotBase64,
                },
              },
            ],
          },
        ],
      });

      // Extract JSON response
      const responseText = result.response.text();
      const jsonMatch =
        responseText.match(/```json\n([\s\S]*?)\n```/) ||
        responseText.match(/{[\s\S]*}/);

      if (jsonMatch) {
        try {
          // Clean up the JSON text
          let jsonText = jsonMatch[1] || jsonMatch[0];
          jsonText = jsonText
            .replace(/\/\/.*$/gm, "") // Remove single line comments
            .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
            .replace(/,\s*}/g, "}") // Remove trailing commas in objects
            .replace(/,\s*]/g, "]") // Remove trailing commas in arrays
            .replace(/[\r\n\t]/g, " ") // Replace newlines and tabs with spaces
            .replace(/\s+/g, " "); // Normalize whitespace

          const missingData = JSON.parse(jsonText);

          // Merge with existing data
          return {
            ...productData,
            ...missingData,
            // Special handling for arrays and objects
            images: [
              ...(productData.images || []),
              ...(missingData.images || []),
            ].filter((v, i, a) => a.indexOf(v) === i),
            variants: {
              ...(productData.variants || {}),
              ...(missingData.variants || {}),
            },
          };
        } catch (jsonError) {
          console.error("Error parsing missing data JSON:", jsonError);

          // Try a more aggressive cleaning approach
          try {
            let jsonText = jsonMatch[1] || jsonMatch[0];
            jsonText = jsonText
              .replace(/[\r\n\t]/g, " ") // Replace newlines and tabs with spaces
              .replace(/\s+/g, " ") // Normalize whitespace
              .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":') // Ensure property names are quoted
              .replace(/:\s*'/g, ':"') // Replace single quotes with double quotes for values
              .replace(/'\s*,/g, '",') // Replace single quotes with double quotes for values
              .replace(/'\s*}/g, '"}') // Replace single quotes with double quotes for values
              .replace(/'\s*]/g, '"]') // Replace single quotes with double quotes for values
              .replace(/:\s*([^",\{\[\]\}]+)(\s*[,\}\]])/g, ':"$1"$2'); // Quote unquoted string values

            const cleanedData = JSON.parse(jsonText);
            return {
              ...productData,
              ...cleanedData,
              images: [
                ...(productData.images || []),
                ...(cleanedData.images || []),
              ].filter((v, i, a) => a.indexOf(v) === i),
            };
          } catch (secondJsonError) {
            console.error("Second JSON parse also failed:", secondJsonError);
          }
        }
      }
    } catch (aiError) {
      console.error("Error filling missing data with Gemini Vision:", aiError);

      // Try with text-only model as fallback
      try {
        const textModel = genAI.getGenerativeModel({
          model: "gemini-1.5-flash",
        });
        const textPrompt = `
        Extract ONLY these specific missing product information: ${missingFields.join(
          ", "
        )}
        From this HTML content. Return ONLY a valid JSON object with these fields.
        Pay special attention to weight information - look for it in product specifications, technical details, or shipping information.
      `;

        const textResult = await textModel.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: textPrompt + "\n\n" + pageContent.substring(0, 20000),
                },
              ],
            },
          ],
        });

        const textResponse = textResult.response.text();
        const textJsonMatch =
          textResponse.match(/```json\n([\s\S]*?)\n```/) ||
          textResponse.match(/{[\s\S]*}/);

        if (textJsonMatch) {
          try {
            let jsonText = textJsonMatch[1] || textJsonMatch[0];
            jsonText = jsonText
              .replace(/\/\/.*$/gm, "")
              .replace(/\/\*[\s\S]*?\*\//g, "")
              .replace(/,\s*}/g, "}")
              .replace(/,\s*]/g, "]")
              .replace(/[\r\n\t]/g, " ")
              .replace(/\s+/g, " ");

            const textMissingData = JSON.parse(jsonText);
            return {
              ...productData,
              ...textMissingData,
            };
          } catch (textJsonError) {
            console.error("Error parsing text JSON:", textJsonError);
          }
        }
      } catch (textError) {
        console.error("Text-only model also failed:", textError);
      }
    }

    // If missing weight specifically after all methods fail, try a generic weight
    if (missingFields.includes("weight") && productData.source === "flipkart") {
      const titleLower = (productData.title || "").toLowerCase();

      // Try to determine a generic weight based on product category clues in title
      if (titleLower.includes("watch") || titleLower.includes("smartwatch")) {
        productData.weight = "Approx. 30-80g (typical smartwatch weight)";
      } else if (
        titleLower.includes("phone") ||
        titleLower.includes("smartphone")
      ) {
        productData.weight = "Approx. 150-200g (typical smartphone weight)";
      } else if (titleLower.includes("laptop")) {
        productData.weight = "Approx. 1.5-2kg (typical laptop weight)";
      } else if (titleLower.includes("tablet")) {
        productData.weight = "Approx. 300-500g (typical tablet weight)";
      } else if (
        titleLower.includes("headphone") ||
        titleLower.includes("earphone") ||
        titleLower.includes("earbud")
      ) {
        productData.weight =
          "Approx. 5-20g per earbud (typical earphone weight)";
      }
    }

    // If we still couldn't parse JSON, return original data with any fixes we managed
    return productData;
  } catch (error) {
    console.error("Error filling missing data with AI:", error);
    return productData;
  }
}
/**
 * Check delivery availability and date using platform-specific methods
 * @param {object} page - Puppeteer page object
 * @param {string} platform - E-commerce platform name
 * @param {string} pincode - Delivery pincode to check
 * @returns {Promise<object>} Delivery information
 */
async function checkDeliveryDate(page, platform, pincode) {
  console.log(`Checking delivery date for ${platform} with pincode ${pincode}`);
  
  try {
    if (platform === 'amazon') {
      return await checkAmazonDeliveryDate(page, pincode);
    } else if (platform === 'flipkart') {
      return await checkFlipkartDeliveryDate(page, pincode);
    } else if (platform === 'myntra') {
      return await checkMyntraDeliveryDate(page, pincode);
    } else if (platform === 'snapdeal') {
      return await checkSnapdealDeliveryDate(page, pincode);
    } else {
      return await checkGenericDeliveryDate(page, pincode);
    }
  } catch (error) {
    console.error(`Error checking delivery date for ${platform}:`, error);
    return {
      available: null,
      estimatedDate: null,
      charges: null,
      pincode: pincode
    };
  }
}

/**
 * Check delivery date for Amazon
 * @param {object} page - Puppeteer page object
 * @param {string} pincode - Delivery pincode to check
 * @returns {Promise<object>} Delivery information
 */
async function checkAmazonDeliveryDate(page, pincode) {
  try {
    // Click the location widget
    try {
      await page.click('#nav-global-location-popover-link');
      await wait(page, 1000);
    } catch (error) {
      console.warn("Could not click Amazon location widget, trying alternative method");
    }
    
    // Wait for pincode input
    try {
      await page.waitForSelector('#GLUXZipUpdateInput', { visible: true, timeout: 10000 });
      
      // Clear and enter pincode
      await page.evaluate(() => document.querySelector('#GLUXZipUpdateInput').value = '');
      await page.type('#GLUXZipUpdateInput', pincode, { delay: 100 });
      
      // Click Apply button
      await page.click('#GLUXZipUpdate input[type="submit"]');
      
      // Wait for page to update
      await wait(page, 3000);
    } catch (error) {
      console.warn("Could not interact with Amazon pincode input, trying alternative selectors");
      
      // Try alternative pincode inputs
      try {
        const altPincodeInputs = [
          'input[name="pinCode"]',
          'input[name="zipCode"]',
          'input[placeholder*="PIN"]',
          'input[aria-label*="pincode"]'
        ];
        
        for (const selector of altPincodeInputs) {
          try {
            const inputExists = await page.$(selector);
            if (inputExists) {
              await page.evaluate(sel => document.querySelector(sel).value = '', selector);
              await page.type(selector, pincode, { delay: 100 });
              
              // Look for nearby submit buttons
              const buttonSelectors = [
                'button:has-text("Apply")',
                'button:has-text("Submit")',
                'button:has-text("Check")',
                'input[type="submit"]'
              ];
              
              for (const btnSelector of buttonSelectors) {
                const btnExists = await page.$(btnSelector);
                if (btnExists) {
                  await page.click(btnSelector);
                  await wait(page, 3000);
                  break;
                }
              }
              break;
            }
          } catch (e) {
            continue;
          }
        }
      } catch (e) {
        console.warn("Alternative Amazon pincode inputs also failed");
      }
    }
    
    // Try multiple selectors for delivery info
    const deliverySelectors = [
      'div#deliveryBlockMessage span.a-text-bold',
      'div#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE span.a-text-bold',
      'div#delivery-block span.a-text-bold',
      'div[data-csa-c-content-id="deliveryMessage"] span.a-text-bold',
      'div[data-feature-name="deliveryBlockMessage"] span.a-text-bold',
      'div:has-text("Delivery") span.a-text-bold'
    ];
    
    for (const selector of deliverySelectors) {
      try {
        await page.waitForSelector(selector, { visible: true, timeout: 5000 });
        const deliveryElem = await page.$(selector);
        if (deliveryElem) {
          let deliveryText = await page.evaluate(el => el.textContent, deliveryElem);
          if (deliveryText) {
            let deliveryInfo = deliveryText.trim();
            deliveryInfo = deliveryInfo.split("Details")[0].trim();
            deliveryInfo = deliveryInfo.split("-")[0].trim();
            
            // Extract charges if available
            let charges = 'Free';
            const deliveryBlock = await page.$('div#deliveryBlockMessage, div[data-feature-name="deliveryBlockMessage"]');
            if (deliveryBlock) {
              const fullText = await page.evaluate(el => el.textContent, deliveryBlock);
              const chargeMatch = fullText.match(/(₹|RS\.|\$|€|£)\s*\d+(\.\d+)?/);
              if (chargeMatch) {
                charges = chargeMatch[0];
              }
            }
            
            return {
              available: true,
              estimatedDate: deliveryInfo,
              charges: charges,
              pincode: pincode
            };
          }
        }
      } catch (error) {
        continue;
      }
    }
    
    // Fallback: get any delivery text
    try {
      const deliveryBlock = await page.$('div#deliveryBlockMessage, div#mir-layout-DELIVERY_BLOCK');
      if (deliveryBlock) {
        const fullText = await page.evaluate(el => el.textContent, deliveryBlock);
        const cleanText = fullText.trim().replace(/\n/g, ' ');
        
        // Try to extract date with regex
        const match = cleanText.match(/(?:delivery by|get it by|arriving by) (\w+,? \w+ \d+)/i);
        if (match) {
          return {
            available: true,
            estimatedDate: match[1],
            charges: cleanText.includes('FREE') ? 'Free' : null,
            pincode: pincode
          };
        } else {
          // Check if delivery is unavailable
          if (cleanText.toLowerCase().includes('not deliver') || 
              cleanText.toLowerCase().includes('unavailable') ||
              cleanText.toLowerCase().includes('can\'t deliver')) {
            return {
              available: false,
              estimatedDate: null,
              charges: null,
              pincode: pincode
            };
          }
          
          return {
            available: true,
            estimatedDate: cleanText.substring(0, 50),
            charges: cleanText.includes('FREE') ? 'Free' : null,
            pincode: pincode
          };
        }
      }
    } catch (error) {
      // Ignore error and continue
    }
    
    return {
      available: null,
      estimatedDate: null,
      charges: null,
      pincode: pincode
    };
  } catch (error) {
    console.error(`Error checking Amazon delivery:`, error);
    return {
      available: null,
      estimatedDate: null,
      charges: null,
      pincode: pincode
    };
  }
}

/**
 * Check delivery date for Flipkart
 * @param {object} page - Puppeteer page object
 * @param {string} pincode - Delivery pincode to check
 * @returns {Promise<object>} Delivery information
 */
async function checkFlipkartDeliveryDate(page, pincode) {
  try {
    console.log("Starting Flipkart delivery check with pincode:", pincode);

    // First, try the direct search for pincode-related elements
    const hasPincodeField = await page.evaluate(() => {
      // Look for elements containing pincode-related text
      const pincodeText = Array.from(document.querySelectorAll("*")).filter(
        (el) => {
          const text = el.textContent.toLowerCase();
          return (
            text.includes("pincode") ||
            text.includes("pin code") ||
            text.includes("delivery available at") ||
            text.includes("enter delivery pincode")
          );
        }
      );

      // If found, click on it to reveal the pincode input
      if (pincodeText.length > 0) {
        // Only click if it looks like it might be interactive
        const clickable = pincodeText.find(
          (el) =>
            el.tagName === "BUTTON" ||
            el.tagName === "SPAN" ||
            el.tagName === "DIV" ||
            el.closest("button") ||
            el.closest('div[role="button"]')
        );

        if (clickable) {
          clickable.click();
          console.log("Clicked on pincode text element");
          return true;
        }
      }
      return false;
    });

    if (hasPincodeField) {
      // Wait a moment for input to appear
      await wait(page, 1000);
    }

    // Try all possible selectors with robust error handling
    const pincodeSelectors = [
      "input#pincodeInputId",
      'input[name="pincode"]',
      'input[placeholder*="pincode"]',
      'input[placeholder*="Pincode"]',
      'input[placeholder*="PIN"]',
      'input[data-component-type*="pincode"]',
      "input._36yFo0",
      "input._2FCIZU",
      'input[class*="pincode"]',
      "input._1z5ndO",
    ];

    let pincodeInputFound = false;

    for (const selector of pincodeSelectors) {
      try {
        console.log(`Trying selector: ${selector}`);
        // Check if this selector exists without waiting
        const exists = await page.evaluate((sel) => {
          return !!document.querySelector(sel);
        }, selector);

        if (exists) {
          console.log(`Found ${selector}`);
          pincodeInputFound = true;

          // Clear and enter pincode
          await page.evaluate(
            (sel, code) => {
              document.querySelector(sel).value = "";
            },
            selector,
            pincode
          );

          await page.type(selector, pincode);

          // Find and click check button
          const checkButtonFound = await page.evaluate((sel) => {
            const input = document.querySelector(sel);
            if (!input) return false;

            // Look for nearby check/submit buttons
            let parent = input.parentElement;
            for (let i = 0; i < 3; i++) {
              // Check up to 3 levels up
              if (!parent) break;

              // Find buttons with 'check' text
              const checkButtons = Array.from(
                parent.querySelectorAll("button, span, div")
              ).filter((el) => {
                const text = el.textContent.toLowerCase().trim();
                return (
                  text === "check" ||
                  text === "submit" ||
                  text === "apply" ||
                  el.tagName === "BUTTON"
                );
              });

              if (checkButtons.length > 0) {
                checkButtons[0].click();
                return true;
              }

              parent = parent.parentElement;
            }

            // As a fallback, simulate pressing Enter key on the input
            const event = new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
            });
            input.dispatchEvent(event);
            return true;
          }, selector);

          if (checkButtonFound) {
            console.log("Check button clicked or Enter pressed");
            await wait(page, 2000);
            break;
          }
        }
      } catch (error) {
        console.warn(
          `Error with selector ${selector}, continuing to next:`,
          error.message
        );
        continue;
      }
    }

    // If we couldn't find or interact with any pincode input, try a different approach
    if (!pincodeInputFound) {
      console.log("No pincode input found, trying page-wide approach");

      // Try to identify and click on any element that might reveal pincode input
      const clickedPincodeReveal = await page.evaluate(() => {
        // Look for elements containing delivery/pincode text
        const deliveryTextElements = Array.from(
          document.querySelectorAll("*")
        ).filter((el) => {
          const text = el.textContent.toLowerCase().trim();
          return (
            text.includes("delivery") ||
            text.includes("pincode") ||
            text.includes("pin code") ||
            text.includes("check")
          );
        });

        // Sort by shortest text (likely to be buttons/labels)
        deliveryTextElements.sort(
          (a, b) => a.textContent.length - b.textContent.length
        );

        // Try clicking on each element
        for (const el of deliveryTextElements.slice(0, 5)) {
          // Try top 5 matches
          try {
            el.click();
          } catch (e) {
            // Ignore errors and try next
          }
        }

        return deliveryTextElements.length > 0;
      });

      if (clickedPincodeReveal) {
        await wait(page, 1000);
      }
    }

    // Now try to find delivery info directly
    console.log("Looking for delivery information");
    const deliveryInfo = await page.evaluate((pincode) => {
      // First, check if there are any elements showing delivery information for the entered pincode
      const deliveryElements = Array.from(
        document.querySelectorAll("*")
      ).filter((el) => {
        const text = el.textContent.toLowerCase();
        return (
          (text.includes("deliver") ||
            text.includes("shipping") ||
            text.includes(pincode)) &&
          text.length < 150
        );
      });

      if (deliveryElements.length > 0) {
        // Sort by specificity - elements with dates or mentions of delivery are more relevant
        deliveryElements.sort((a, b) => {
          const textA = a.textContent.toLowerCase();
          const textB = b.textContent.toLowerCase();

          const scoreA =
            textA.includes("delivery by") * 3 +
            textA.includes("expected") * 2 +
            textA.includes(pincode) * 3 +
            /\d+\s*\w+/.test(textA) * 2; // Has numbers followed by text (like "2 days")

          const scoreB =
            textB.includes("delivery by") * 3 +
            textB.includes("expected") * 2 +
            textB.includes(pincode) * 3 +
            /\d+\s*\w+/.test(textB) * 2;

          return scoreB - scoreA;
        });

        const bestElement = deliveryElements[0];
        const deliveryText = bestElement.textContent.trim();

        // Check if delivery is not available
        const notAvailable =
          deliveryText.toLowerCase().includes("not available") ||
          deliveryText.toLowerCase().includes("cannot be delivered") ||
          deliveryText.toLowerCase().includes("out of reach") ||
          deliveryText.toLowerCase().includes("not deliverable");

        // Extract estimated date
        let estimatedDate = null;
        // Look for date patterns
        const datePattern1 = deliveryText.match(
          /(?:by|on)\s+([A-Za-z]+\s+\d+(?:st|nd|rd|th)?)/i
        );
        const datePattern2 = deliveryText.match(
          /(\d+(?:st|nd|rd|th)?\s+[A-Za-z]+)/i
        );
        const datePattern3 = deliveryText.match(
          /([A-Za-z]+\s+\d+(?:st|nd|rd|th)?)/i
        );
        const daysPattern = deliveryText.match(/(\d+)\s*(?:-\s*\d+)?\s*days?/i);

        if (datePattern1) estimatedDate = datePattern1[1];
        else if (datePattern2) estimatedDate = datePattern2[1];
        else if (datePattern3) estimatedDate = datePattern3[1];
        else if (daysPattern) estimatedDate = `${daysPattern[0]} from now`;

        // Extract charges
        let charges = "Free";
        if (deliveryText.toLowerCase().includes("free")) {
          charges = "Free";
        } else {
          const chargePattern = deliveryText.match(/(₹|RS\.)\s*\d+(\.\d+)?/i);
          if (chargePattern) {
            charges = chargePattern[0];
          }
        }

        return {
          available: !notAvailable,
          estimatedDate: estimatedDate || deliveryText,
          charges: charges,
          pincodeFound: true,
        };
      }

      // If we don't find any elements with delivery info, see if we can find a generic delivery message
      const fallbackElements = Array.from(
        document.querySelectorAll("*")
      ).filter((el) => {
        const text = el.textContent.toLowerCase();
        return (
          text.includes("usually delivered") ||
          text.includes("standard delivery")
        );
      });

      if (fallbackElements.length > 0) {
        return {
          available: true,
          estimatedDate: fallbackElements[0].textContent.trim(),
          charges: "Check at checkout",
          pincodeFound: false,
        };
      }

      return {
        available: null,
        estimatedDate: null,
        charges: null,
        pincodeFound: false,
      };
    }, pincode);

    if (deliveryInfo.pincodeFound) {
      console.log(`Found delivery info for ${pincode}:`, deliveryInfo);
      return {
        available: deliveryInfo.available,
        estimatedDate: deliveryInfo.estimatedDate,
        charges: deliveryInfo.charges,
        pincode: pincode,
      };
    }

    // If we still couldn't find delivery info, look for product-wide delivery info
    const genericDeliveryInfo = await page.evaluate(() => {
      // Find any elements with delivery-related text
      const elements = Array.from(document.querySelectorAll("*")).filter(
        (el) => {
          const text = el.textContent.toLowerCase();
          return (
            (text.includes("deliver") ||
              text.includes("shipping") ||
              text.includes("dispatch")) &&
            text.length < 150
          );
        }
      );

      if (elements.length > 0) {
        const deliveryText = elements[0].textContent.trim();

        // Extract estimated timeframe
        let estimatedDate = null;
        if (deliveryText.includes("day")) {
          const daysMatch = deliveryText.match(/(\d+)\s*(?:-\s*\d+)?\s*days?/i);
          if (daysMatch) {
            estimatedDate = `${daysMatch[0]} standard delivery`;
          } else {
            estimatedDate = deliveryText;
          }
        } else {
          estimatedDate = deliveryText;
        }

        return {
          available: true,
          estimatedDate: estimatedDate,
          charges: "Check at checkout",
        };
      }

      return {
        available: null,
        estimatedDate: "Delivery information unavailable",
        charges: null,
      };
    });

    return {
      available: genericDeliveryInfo.available,
      estimatedDate: genericDeliveryInfo.estimatedDate,
      charges: genericDeliveryInfo.charges,
      pincode: pincode,
    };
  } catch (error) {
    console.error(`Error checking Flipkart delivery:`, error);
    return {
      available: null,
      estimatedDate: "Error checking delivery",
      charges: null,
      pincode: pincode,
    };
  }
}

/**
 * Check delivery date for Myntra
 * @param {object} page - Puppeteer page object
 * @param {string} pincode - Delivery pincode to check
 * @returns {Promise<object>} Delivery information
 */
async function checkMyntraDeliveryDate(page, pincode) {
  try {
    // Method 1: Look for pincode input
    const pincodeSelectors = [
      'input.pincode-code',
      'input[placeholder*="Enter PIN code"]',
      'input[data-test="pincode-input"]',
      'input[name="pincode"]',
      'input:has-text("PIN")',
      'input:has-text("pincode")'
    ];
    
    for (const selector of pincodeSelectors) {
      try {
        await page.waitForSelector(selector, { visible: true, timeout: 5000 });
        await page.evaluate((sel) => {
          document.querySelector(sel).value = '';
        }, selector);
        await page.type(selector, pincode);
        
        // Click check button
        const checkSelectors = [
          'button.pincode-check',
          'button[data-test="pincode-check"]',
          'button:has-text("CHECK")',
          'button:has-text("Check")',
          'span:has-text("Check")',
          'button.check-button'
        ];
        
        let clickSuccess = false;
        for (const checkSelector of checkSelectors) {
          try {
            await page.click(checkSelector);
            clickSuccess = true;
            break;
          } catch (error) {
            continue;
          }
        }
        
        if (clickSuccess) {
          // Wait for delivery info
          await wait(page, 2000);
          
          // Get delivery info
          const deliverySelectors = [
            'div.pincode-deliveryInfo',
            'div.delivery-info',
            'div[data-test="delivery-info"]',
            'div.shipping-info',
            'div:has-text("Expected delivery")',
            'div:has-text("Get it by")'
          ];
          
          for (const deliverySelector of deliverySelectors) {
            try {
              await page.waitForSelector(deliverySelector, { visible: true, timeout: 3000 });
              const deliveryElem = await page.$(deliverySelector);
              if (deliveryElem) {
                const deliveryInfo = await page.evaluate(el => el.textContent, deliveryElem);
                const cleanInfo = deliveryInfo.trim();
                
                // Check for charges
                let charges = 'Free';
                const chargeMatch = cleanInfo.match(/(₹|RS\.)\s*\d+(\.\d+)?/);
                if (chargeMatch) {
                  charges = chargeMatch[0];
                }
                
                // Extract date
                const dateMatch = cleanInfo.match(/(?:by|on) ([A-Za-z]+ \d+(?:st|nd|rd|th)?)/i) || 
                                  cleanInfo.match(/(\d+(?:st|nd|rd|th)? [A-Za-z]+)/i);
                
                // Check if unavailable
                if (cleanInfo.toLowerCase().includes('not deliver') || 
                    cleanInfo.toLowerCase().includes('unavailable')) {
                  return {
                    available: false,
                    estimatedDate: null,
                    charges: null,
                    pincode: pincode
                  };
                }
                
                return {
                  available: true,
                  estimatedDate: dateMatch ? dateMatch[1] : cleanInfo,
                  charges: charges,
                  pincode: pincode
                };
              }
            } catch (error) {
              continue;
            }
          }
        }
      } catch (error) {
        console.warn(`Error with selector ${selector}:`, error);
        continue;
      }
    }
    
    // Method 2: Look for existing delivery info
    const existingDeliverySelectors = [
      'div.delivery-date',
      'span.delivery-info',
      'div[data-test="delivery-message"]',
      'div.shipping-details',
      'div:has-text("Get it by")'
    ];
    
    for (const selector of existingDeliverySelectors) {
      try {
        const elem = await page.$(selector);
        if (elem) {
          const text = await page.evaluate(el => el.textContent, elem);
          if (text.toLowerCase().includes('deliver') || text.toLowerCase().includes('get')) {
            // Check if unavailable
            if (text.toLowerCase().includes('not deliver') || 
                text.toLowerCase().includes('unavailable')) {
              return {
                available: false,
                estimatedDate: null,
                charges: null,
                pincode: pincode
              };
            }
            
            // Extract charges
            let charges = 'Free';
            const chargeMatch = text.match(/(₹|RS\.)\s*\d+(\.\d+)?/);
            if (chargeMatch) {
              charges = chargeMatch[0];
            }
            
            // Extract date
            const dateMatch = text.match(/(?:by|on) ([A-Za-z]+ \d+(?:st|nd|rd|th)?)/i) || 
                             text.match(/(\d+(?:st|nd|rd|th)? [A-Za-z]+)/i);
            
            return {
              available: true,
              estimatedDate: dateMatch ? dateMatch[1] : text.trim(),
              charges: charges,
              pincode: pincode
            };
          }
        }
      } catch (error) {
        continue;
      }
    }
    
    return {
      available: null,
      estimatedDate: null,
      charges: null,
      pincode: pincode
    };
  } catch (error) {
    console.error(`Error checking Myntra delivery:`, error);
    return {
      available: null,
      estimatedDate: null,
      charges: null,
      pincode: pincode
    };
  }
}

/**
 * Check delivery date for Snapdeal
 * @param {object} page - Puppeteer page object
 * @param {string} pincode - Delivery pincode to check
 * @returns {Promise<object>} Delivery information
 */
async function checkSnapdealDeliveryDate(page, pincode) {
  try {
    // Method 1: Click pincode check and enter pincode
    const pincodeAreaSelectors = [
      '#pincode-check',
      'div.pincode-check',
      'div[data-input="pincode"]',
      'div:has-text("Delivery")',
      'div:has-text("pincode")'
    ];
    
    for (const selector of pincodeAreaSelectors) {
      try {
        await page.click(selector);
        await wait(page, 1000);
        
        // Look for pincode input
        const pincodeInputSelectors = [
          '#pincode-check-input',
          'input[name="pincode"]',
          'input[placeholder*="pincode"]',
          'input[placeholder*="PIN"]',
          'input:has-text("Enter PIN")'
        ];
        
        for (const inputSelector of pincodeInputSelectors) {
          try {
            await page.waitForSelector(inputSelector, { visible: true, timeout: 3000 });
            await page.evaluate((sel) => {
              document.querySelector(sel).value = '';
            }, inputSelector);
            await page.type(inputSelector, pincode);
            
            // Click check button
            const checkSelectors = [
              '#check-pincode-button',
              'button.pincode-check-btn',
              'button:has-text("CHECK")',
              'button:has-text("Check")',
              'button[data-action="check-pincode"]',
              'span:has-text("Check")'
            ];
            
            let clickSuccess = false;
            for (const checkSelector of checkSelectors) {
              try {
                await page.click(checkSelector);
                clickSuccess = true;
                break;
              } catch (error) {
                continue;
              }
            }
            
            if (clickSuccess) {
              // Wait for delivery info
              await wait(page, 2000);
              
              // Get delivery info
              const deliverySelectors = [
                '.delivery-day-text',
                'div.delivery-info',
                'span.delivery-message',
                'div[data-delivery="message"]',
                'div:has-text("Expected delivery")',
                'div:has-text("Delivered by")'
              ];
              
              for (const deliverySelector of deliverySelectors) {
                try {
                  await page.waitForSelector(deliverySelector, { visible: true, timeout: 3000 });
                  const deliveryElem = await page.$(deliverySelector);
                  if (deliveryElem) {
                    const deliveryInfo = await page.evaluate(el => el.textContent, deliveryElem);
                    const cleanInfo = deliveryInfo.trim();
                    
                    // Check for charges
                    let charges = 'Free';
                    const chargeMatch = cleanInfo.match(/(₹|RS\.)\s*\d+(\.\d+)?/);
                    if (chargeMatch) {
                      charges = chargeMatch[0];
                    }
                    
                    // Extract date
                    const dateMatch = cleanInfo.match(/(?:by|on) ([A-Za-z]+ \d+(?:st|nd|rd|th)?)/i) || 
                                      cleanInfo.match(/(\d+(?:st|nd|rd|th)? [A-Za-z]+)/i);
                    
                    // Check if unavailable
                    if (cleanInfo.toLowerCase().includes('not deliver') || 
                        cleanInfo.toLowerCase().includes('unavailable')) {
                      return {
                        available: false,
                        estimatedDate: null,
                        charges: null,
                        pincode: pincode
                      };
                    }
                    
                    return {
                      available: true,
                      estimatedDate: dateMatch ? dateMatch[1] : cleanInfo,
                      charges: charges,
                      pincode: pincode
                    };
                  }
                } catch (error) {
                  continue;
                }
              }
            }
          } catch (error) {
            console.warn(`Error with input selector ${inputSelector}:`, error);
            continue;
          }
        }
      } catch (error) {
        console.warn(`Error with area selector ${selector}:`, error);
        continue;
      }
    }
    
    // Method 2: Check for existing delivery info
    const existingDeliverySelectors = [
      'div.cod-details',
      'span.delivery-info',
      'div.shipping-text',
      'div:has-text("Delivered by")',
      'div:has-text("Delivery")'
    ];
    
    for (const selector of existingDeliverySelectors) {
      try {
        const elem = await page.$(selector);
        if (elem) {
          const text = await page.evaluate(el => el.textContent, elem);
          if (text.toLowerCase().includes('deliver') || text.toLowerCase().includes('days')) {
            // Check if unavailable
            if (text.toLowerCase().includes('not deliver') || 
                text.toLowerCase().includes('unavailable')) {
              return {
                available: false,
                estimatedDate: null,
                charges: null,
                pincode: pincode
              };
            }
            
            // Extract charges
            let charges = 'Free';
            const chargeMatch = text.match(/(₹|RS\.)\s*\d+(\.\d+)?/);
            if (chargeMatch) {
              charges = chargeMatch[0];
            }
            
            // Extract date
            const dateMatch = text.match(/(?:by|on) ([A-Za-z]+ \d+(?:st|nd|rd|th)?)/i) || 
                             text.match(/(\d+(?:st|nd|rd|th)? [A-Za-z]+)/i);
            
            return {
              available: true,
              estimatedDate: dateMatch ? dateMatch[1] : text.trim(),
              charges: charges,
              pincode: pincode
            };
          }
        }
      } catch (error) {
        continue;
      }
    }
    
    return {
      available: null,
      estimatedDate: null,
      charges: null,
      pincode: pincode
    };
  } catch (error) {
    console.error(`Error checking Snapdeal delivery:`, error);
    return {
      available: null,
      estimatedDate: null,
      charges: null,
      pincode: pincode
    };
  }
}

/**
 * Generic delivery date checker for unsupported platforms
 * @param {object} page - Puppeteer page object
 * @param {string} pincode - Delivery pincode to check
 * @returns {Promise<object>} Delivery information
 */
async function checkGenericDeliveryDate(page, pincode) {
  try {
    // Look for pincode input fields
    const pincodeInputs = await page.evaluate((pincode) => {
      // Look for input fields that might be for pincode
      const inputs = Array.from(document.querySelectorAll('input'))
        .filter(input => {
          const placeholder = (input.placeholder || '').toLowerCase();
          const name = (input.name || '').toLowerCase();
          const id = (input.id || '').toLowerCase();
          const nearbyText = input.parentElement?.textContent.toLowerCase() || '';
          
          return placeholder.includes('pin') || 
                 placeholder.includes('zip') || 
                 name.includes('pin') || 
                 name.includes('zip') || 
                 id.includes('pin') || 
                 id.includes('zip') ||
                 nearbyText.includes('pincode') ||
                 nearbyText.includes('pin code') ||
                 nearbyText.includes('delivery');
        });
      
      if (inputs.length > 0) {
        // Found a pincode input, now fill it
        const input = inputs[0];
        input.value = pincode;
        
        // Try to find and click a check button
        const parent = input.closest('div') || input.parentElement;
        if (parent) {
          // Look for check button
          const checkButtons = Array.from(parent.querySelectorAll('button, input[type="submit"], div[role="button"]'))
            .filter(btn => {
              const text = btn.textContent.toLowerCase().trim();
              return text.includes('check') || 
                     text.includes('apply') || 
                     text.includes('submit') ||
                     text === 'go';
            });
          
          if (checkButtons.length > 0) {
            checkButtons[0].click();
            return true;
          } else {
            // Try to simulate enter key
            const event = new KeyboardEvent('keydown', { 'key': 'Enter' });
            input.dispatchEvent(event);
            return true;
          }
        }
      }
      
      return false;
    }, pincode);
    
    // Wait for delivery check to update the page
    await wait(page, 3000);
    
    // Look for delivery information
    const deliveryInfo = await page.evaluate((pincode) => {
      // Look for elements with delivery information
      const deliveryElements = Array.from(document.querySelectorAll('*'))
        .filter(el => {
          const text = el.textContent.toLowerCase().trim();
          return (text.includes('delivery') || 
                  text.includes('shipping') || 
                  text.includes('dispatch') || 
                  text.includes('arrives')) &&
                  text.length < 150;
        });
      
      // Sort by relevance - elements with dates or specific delivery info are more relevant
      deliveryElements.sort((a, b) => {
        const textA = a.textContent.toLowerCase();
        const textB = b.textContent.toLowerCase();
        
        // Check for date patterns
        const hasDateA = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d+\b/i.test(textA) ||
                        /\b\d+(?:st|nd|rd|th)\b/i.test(textA) ||
                        /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(textA);
                        
        const hasDateB = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d+\b/i.test(textB) ||
                        /\b\d+(?:st|nd|rd|th)\b/i.test(textB) ||
                        /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(textB);
        
        if (hasDateA && !hasDateB) return -1;
        if (!hasDateA && hasDateB) return 1;
        
        // Check for delivery keywords
        const deliveryScoreA = (textA.includes('estimated delivery') * 3) + 
                              (textA.includes('delivery by') * 3) +
                              (textA.includes('delivery date') * 3) +
                              (textA.includes('delivery') * 1);
                              
        const deliveryScoreB = (textB.includes('estimated delivery') * 3) + 
                              (textB.includes('delivery by') * 3) +
                              (textB.includes('delivery date') * 3) +
                              (textB.includes('delivery') * 1);
        
        return deliveryScoreB - deliveryScoreA;
      });
      
      if (deliveryElements.length > 0) {
        // Extract the best delivery info
        const topElement = deliveryElements[0];
        const deliveryText = topElement.textContent.trim();
        
        // Check if delivery is not available
        const notAvailable = deliveryText.toLowerCase().includes('not available') || 
                             deliveryText.toLowerCase().includes('cannot be delivered') ||
                             deliveryText.toLowerCase().includes('not deliver');
        
        // Extract delivery date
        let estimatedDate = null;
        const datePattern1 = deliveryText.match(/(?:by|on)\s+([A-Za-z]+\s+\d+(?:st|nd|rd|th)?)/i);
        const datePattern2 = deliveryText.match(/(\d+(?:st|nd|rd|th)?\s+[A-Za-z]+)/i);
        const datePattern3 = deliveryText.match(/([A-Za-z]+\s+\d+(?:st|nd|rd|th)?)/i);
        
        if (datePattern1) {
          estimatedDate = datePattern1[1];
        } else if (datePattern2) {
          estimatedDate = datePattern2[1];
        } else if (datePattern3) {
          estimatedDate = datePattern3[1];
        } else if (deliveryText.toLowerCase().includes('day')) {
          // Look for "X days" pattern
          const daysPattern = deliveryText.match(/(\d+)\s*(?:-\s*\d+)?\s*days?/i);
          if (daysPattern) {
            estimatedDate = `${daysPattern[0]} from now`;
          }
        }
        
        // Extract delivery charges
        let charges = 'Free';
        if (deliveryText.toLowerCase().includes('free')) {
          charges = 'Free';
        } else {
          const chargePattern = deliveryText.match(/(₹|RS\.|\$|€|£)\s*\d+(\.\d+)?/i);
          if (chargePattern) {
            charges = chargePattern[0];
          }
        }
        
        return {
          available: !notAvailable,
          estimatedDate: estimatedDate || deliveryText.substring(0, 100),
          charges: charges,
          pincode: pincode
        };
      }
      
      return {
        available: null,
        estimatedDate: null,
        charges: null,
        pincode: pincode
      };
    }, pincode);
    
    return deliveryInfo;
  } catch (error) {
    console.error(`Error checking generic delivery:`, error);
    return {
      available: null,
      estimatedDate: null,
      charges: null,
      pincode: pincode
    };
  }
}
async function findPincodeInput(page) {
  console.log("Scanning page for pincode input fields...");

  return await page.evaluate(() => {
    // Try to find any input field that might be for pincode entry
    const allInputs = Array.from(document.querySelectorAll("input"));

    // Score inputs based on pincode relevance
    const scoredInputs = allInputs.map((input) => {
      let score = 0;

      // Check attributes for pincode indicators
      const placeholder = (input.placeholder || "").toLowerCase();
      const name = (input.name || "").toLowerCase();
      const id = (input.id || "").toLowerCase();
      const type = (input.type || "").toLowerCase();
      const className = (input.className || "").toLowerCase();
      const ariaLabel = (input.getAttribute("aria-label") || "").toLowerCase();

      // Numeric inputs are likely candidates
      if (type === "number") score += 3;
      if (input.maxLength === 6) score += 3; // Indian pincodes are 6 digits

      // Check for pincode-related terms in various attributes
      if (placeholder.includes("pin") || placeholder.includes("zip"))
        score += 5;
      if (name.includes("pin") || name.includes("zip")) score += 4;
      if (id.includes("pin") || id.includes("zip")) score += 4;
      if (className.includes("pin") || className.includes("zip")) score += 3;
      if (ariaLabel.includes("pin") || ariaLabel.includes("zip")) score += 4;

      // Check surrounding text for pincode context
      const parent = input.parentElement;
      if (parent) {
        const parentText = parent.textContent.toLowerCase();
        if (
          parentText.includes("pincode") ||
          parentText.includes("pin code") ||
          parentText.includes("zip code") ||
          parentText.includes("delivery")
        ) {
          score += 5;
        }
      }

      // Check for labels associated with this input
      const labels = document.querySelectorAll(`label[for="${input.id}"]`);
      for (const label of labels) {
        const labelText = label.textContent.toLowerCase();
        if (
          labelText.includes("pin") ||
          labelText.includes("zip") ||
          labelText.includes("delivery")
        ) {
          score += 5;
        }
      }

      return { element: input, score };
    });

    // Sort by score (highest first)
    scoredInputs.sort((a, b) => b.score - a.score);

    // Return info about the best candidate
    if (scoredInputs.length > 0 && scoredInputs[0].score > 2) {
      const bestInput = scoredInputs[0].element;
      return {
        found: true,
        id: bestInput.id,
        name: bestInput.name,
        className: bestInput.className,
        placeholder: bestInput.placeholder,
        type: bestInput.type,
        xpath: getXPathForElement(bestInput),
      };
    }

    // Helper function to get XPath
    function getXPathForElement(element) {
      if (!element) return "";

      // Use id if available
      if (element.id) return `//*[@id="${element.id}"]`;

      let path = "";
      let current = element;

      while (current && current !== document.body) {
        let tag = current.tagName.toLowerCase();
        let siblings = Array.from(current.parentNode.childNodes).filter(
          (n) => n.nodeType === 1 && n.tagName === current.tagName
        );

        if (siblings.length > 1) {
          let index = siblings.indexOf(current) + 1;
          tag += `[${index}]`;
        }

        path = `/${tag}${path}`;
        current = current.parentNode;

        // Prevent infinite loops
        if (path.length > 500) break;
      }

      return `/html/body${path}`;
    }

    return { found: false };
  });
}

  
async function extractDeliveryTextWithoutPincode(page) {
  return await page.evaluate(() => {
    // Look for any delivery-related text on the page
    const deliveryElements = Array.from(document.querySelectorAll("*"))
      .filter((el) => {
        const text = el.textContent.toLowerCase();
        return (
          (text.includes("deliver") ||
            text.includes("shipping") ||
            text.includes("dispatch") ||
            text.includes("standard delivery")) &&
          text.length < 200
        );
      })
      .map((el) => ({
        element: el,
        text: el.textContent.trim(),
      }));

    // Score elements based on relevance
    deliveryElements.forEach((item) => {
      const text = item.text.toLowerCase();
      let score = 0;

      if (text.includes("delivery by")) score += 5;
      if (text.includes("expected delivery")) score += 5;
      if (text.includes("standard delivery")) score += 4;
      if (text.includes("typically delivered")) score += 4;
      if (text.includes("usually delivered")) score += 4;
      if (text.includes("delivery")) score += 1;
      if (text.includes("free")) score += 2;
      if (/\d+\s*\w+/.test(text)) score += 3; // Has numbers (like "2 days")

      item.score = score;
    });

    // Sort by score (highest first)
    deliveryElements.sort((a, b) => b.score - a.score);

    if (deliveryElements.length > 0) {
      const best = deliveryElements[0];

      // Try to extract delivery timeframe
      const text = best.text.toLowerCase();
      let estimatedDate = best.text;
      let available = true;

      // Check for unavailability
      if (
        text.includes("not available") ||
        text.includes("cannot be delivered") ||
        text.includes("unavailable")
      ) {
        available = false;
      }

      // Check for delivery timeframe
      const dayMatch = text.match(/(\d+)\s*(?:-\s*\d+)?\s*days?/i);
      const dateMatch =
        text.match(/(?:by|on)\s+([A-Za-z]+\s+\d+(?:st|nd|rd|th)?)/i) ||
        text.match(/(\d+(?:st|nd|rd|th)?\s+[A-Za-z]+)/i);

      if (dayMatch) {
        estimatedDate = `${dayMatch[0]} standard delivery`;
      } else if (dateMatch) {
        estimatedDate = dateMatch[1];
      }

      // Check for charges
      let charges = "Check at checkout";
      if (text.includes("free delivery") || text.includes("free shipping")) {
        charges = "Free";
      } else {
        const chargeMatch = text.match(/(₹|RS\.|\$|€|£)\s*\d+(\.\d+)?/i);
        if (chargeMatch) {
          charges = chargeMatch[0];
        }
      }

      return {
        found: true,
        available,
        estimatedDate,
        charges,
      };
    }

    return { found: false };
  });
}


/**
 * Use AI and direct methods to check delivery information
 * @param {object} page - Puppeteer page object
 * @param {string} platform - E-commerce platform name
 * @param {string} pincode - Delivery pincode to check
 * @returns {Promise<object>} Delivery information
 */
async function checkDeliveryWithAI(page, platform, pincode) {
  console.log(`Checking delivery for pincode ${pincode} on ${platform}`);

  try {
    // First try direct platform-specific approach
    const directDeliveryInfo = await checkDeliveryDate(page, platform, pincode);

    // If we got clear delivery info, return it
    if (
      directDeliveryInfo.estimatedDate &&
      directDeliveryInfo.estimatedDate !== "Error checking delivery"
    ) {
      return directDeliveryInfo;
    }

    // If we couldn't get delivery info through regular methods, try finding any pincode input
    const pincodeInputInfo = await findPincodeInput(page);

    if (pincodeInputInfo.found) {
      console.log("Found pincode input through scanning:", pincodeInputInfo);

      // Try to interact with it using the specific information we found
      try {
        if (pincodeInputInfo.id) {
          await page.type(`#${pincodeInputInfo.id}`, pincode);
        } else if (pincodeInputInfo.xpath) {
          await page.evaluate(
            (xpath, value) => {
              const element = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
              ).singleNodeValue;
              if (element) {
                element.value = value;
                element.dispatchEvent(new Event("input", { bubbles: true }));
                element.dispatchEvent(new Event("change", { bubbles: true }));

                // Simulate Enter key
                element.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "Enter",
                    code: "Enter",
                  })
                );
              }
            },
            pincodeInputInfo.xpath,
            pincode
          );
        }

        // Try to find and click a submit button
        await page.evaluate(() => {
          // Look for nearby submit/check buttons
          const buttons = Array.from(
            document.querySelectorAll(
              'button, input[type="submit"], div[role="button"]'
            )
          ).filter((btn) => {
            const text = (btn.textContent || "").toLowerCase().trim();
            return (
              text === "check" ||
              text === "submit" ||
              text === "apply" ||
              text === "go"
            );
          });

          if (buttons.length > 0) {
            buttons[0].click();
            return true;
          }
          return false;
        });

        // Wait for page to update
        await wait(page, 2000);
      } catch (inputError) {
        console.warn(
          "Error interacting with discovered pincode input:",
          inputError.message
        );
      }
    }

    // Try to extract delivery text without pincode
    const deliveryTextInfo = await extractDeliveryTextWithoutPincode(page);
    if (deliveryTextInfo.found) {
      console.log(
        "Found delivery text without pincode input:",
        deliveryTextInfo
      );
      return {
        available: deliveryTextInfo.available,
        estimatedDate: deliveryTextInfo.estimatedDate,
        charges: deliveryTextInfo.charges,
        pincode: pincode,
      };
    }

    // If we still don't have delivery info, try AI vision as a last resort
    console.log("Using AI vision to extract delivery info");
    try {
      const screenshotBuffer = await page.screenshot({ fullPage: false }); // Capture just visible part
      const screenshotBase64 = screenshotBuffer.toString("base64");

      const geminiModel = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
      });

      const deliveryPrompt = `
      I need to extract delivery information for pincode ${pincode} on this ${platform} e-commerce page.
      
      Look at the page and tell me:
      1. Is delivery available? (true/false)
      2. What is the estimated delivery date or time frame?
      3. Are there any delivery charges?
      
      Even if you don't see specific information for the pincode ${pincode}, tell me any general delivery information visible on the page.
      
      Return the information as a JSON object with these fields:
      {
        "available": boolean or null if unknown,
        "estimatedDate": "string with delivery date/timeframe or general delivery info",
        "charges": "string with delivery fee or 'Free' or 'Check at checkout' if unknown"
      }
    `;

      const deliveryResult = await geminiModel.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              { text: deliveryPrompt },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: screenshotBase64,
                },
              },
            ],
          },
        ],
      });

      const deliveryText = deliveryResult.response.text();
      const jsonMatch =
        deliveryText.match(/```json\n([\s\S]*?)\n```/) ||
        deliveryText.match(/{[\s\S]*}/);

      if (jsonMatch) {
        try {
          const jsonText = jsonMatch[1] || jsonMatch[0];
          // Clean up the JSON text
          const cleanedJson = jsonText
            .replace(/\/\/.*$/gm, "") // Remove single line comments
            .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
            .replace(/,\s*}/g, "}") // Remove trailing commas in objects
            .replace(/,\s*]/g, "]") // Remove trailing commas in arrays
            .replace(/[\r\n\t]/g, " ") // Replace newlines and tabs with spaces
            .replace(/\s+/g, " "); // Normalize whitespace

          const deliveryInfo = JSON.parse(cleanedJson);
          return {
            available: deliveryInfo.available,
            estimatedDate: deliveryInfo.estimatedDate,
            charges: deliveryInfo.charges,
            pincode: pincode,
          };
        } catch (jsonError) {
          console.error("Error parsing AI delivery JSON:", jsonError.message);
        }
      }
    } catch (aiError) {
      console.error("Gemini delivery extraction failed:", aiError);
    }

    // Last resort - return a generic message
    return {
      available: true,
      estimatedDate:
        "Standard delivery available, check at checkout for exact timeframe",
      charges: "Check at checkout",
      pincode: pincode,
    };
  } catch (error) {
    console.error("Error checking delivery with AI:", error);
    return {
      available: true,
      estimatedDate: "Standard delivery, check at checkout for details",
      charges: "Check at checkout",
      pincode: pincode,
    };
  }
}

/**
 * Select product variants
 * @param {object} page - Puppeteer page object
 * @param {string} platform - E-commerce platform name
 * @param {object} variants - Object with variant types and values to select
 * @returns {Promise<boolean>} Success status
 */
async function selectVariants(page, platform, variants) {
  if (!variants || Object.keys(variants).length === 0) {
    return true;
  }

  console.log(`Selecting variants for ${platform}:`, variants);
  let success = true;

  try {
    // Create index if it doesn't exist yet
    const pageIndex = await createInvertedIndex(page);

    for (const [variantType, variantValue] of Object.entries(variants)) {
      console.log(`Selecting ${variantType}: ${variantValue}`);

      const selected = await page.evaluate(
        (variantType, variantValue) => {
          // Find elements that match the variant type
          const variantTypeElements = Array.from(
            document.querySelectorAll("*")
          ).filter((el) => {
            const text = el.textContent.toLowerCase();
            return text.includes(variantType.toLowerCase());
          });

          // Find elements that match the variant value
          const variantValueElements = Array.from(
            document.querySelectorAll("*")
          ).filter((el) => {
            const text = el.textContent.toLowerCase().trim();
            return text === variantValue.toLowerCase();
          });

          // Look for elements with the exact value
          if (variantValueElements.length > 0) {
            for (const element of variantValueElements) {
              // Check if it's clickable
              if (
                element.tagName === "BUTTON" ||
                element.tagName === "LI" ||
                element.tagName === "DIV" ||
                element.tagName === "OPTION" ||
                element.getAttribute("role") === "button"
              ) {
                element.click();
                return true;
              }

              // Check parent for clickability
              const parent = element.parentElement;
              if (
                parent &&
                (parent.tagName === "BUTTON" ||
                  parent.tagName === "LI" ||
                  parent.tagName === "DIV" ||
                  parent.getAttribute("role") === "button")
              ) {
                parent.click();
                return true;
              }
            }
          }

          // If not found, try finding variant options near variant type labels
          if (variantTypeElements.length > 0) {
            for (const element of variantTypeElements) {
              const parent = element.closest("div") || element.parentElement;
              if (!parent) continue;

              // Look for clickable elements with matching value
              const options = parent.querySelectorAll(
                'button, li, div[role="button"], span'
              );
              for (const option of options) {
                if (
                  option.textContent.toLowerCase().trim() ===
                  variantValue.toLowerCase()
                ) {
                  option.click();
                  return true;
                }
              }
            }
          }

          // As a last resort, try to find any elements that contain the value
          const potentialVariants = Array.from(
            document.querySelectorAll('button, li, div[role="button"], span')
          ).filter(
            (el) =>
              el.textContent.toLowerCase().trim() === variantValue.toLowerCase()
          );

          if (potentialVariants.length > 0) {
            potentialVariants[0].click();
            return true;
          }

          return false;
        },
        variantType,
        variantValue
      );

      // Wait for page to update after variant selection
      await wait(page, 2000);

      if (!selected) {
        console.log(`⚠️ Could not select ${variantType}: ${variantValue}`);
        success = false;
      }
    }

    return success;
  } catch (error) {
    console.error(`Error selecting variants:`, error);
    return false;
  }
}

/**
 * Handle missing data in product object
 * @param {object} productData - Product data to validate and fix
 * @returns {object} Complete product object with defaults for missing fields
 */
function handleMissingData(productData) {
  // Create a complete product object with all expected fields
  return {
    title: productData.title || "Unknown Product",
    price: productData.price || null,
    originalPrice: productData.originalPrice || null,
    description: productData.description || "No description available",
    features: Array.isArray(productData.features) ? productData.features : [],
    variants: {
      sizes: Array.isArray(productData.variants?.sizes)
        ? productData.variants.sizes
        : [],
      colors: Array.isArray(productData.variants?.colors)
        ? productData.variants.colors
        : [],
      other: Array.isArray(productData.variants?.other)
        ? productData.variants.other
        : [],
    },
    images: Array.isArray(productData.images) ? productData.images : [],
    delivery: {
      available: productData.delivery?.available ?? null,
      estimatedDate: productData.delivery?.estimatedDate || null,
      charges: productData.delivery?.charges || null,
      pincode: productData.delivery?.pincode || "201001",
    },
    weight: productData.weight || null,
    category: productData.category || "Uncategorized",
    source: productData.source || null,
    scrapedAt: productData.scrapedAt || new Date().toISOString(),
    originalUrl: productData.originalUrl || null,
  };
}

/**
 * Get cached product data if available
 * @param {string} url - Product page URL
 * @returns {Promise<object|null>} Cached product data or null
 */
async function getCachedProduct(url) {
  try {
    // Create cache directory if it doesn't exist
    await fs.mkdir(CACHE_DIR, { recursive: true });

    // Use MD5 for shorter filenames
    const urlHash = crypto.createHash("md5").update(url).digest("hex");

    const cachePath = path.join(CACHE_DIR, `${urlHash}.json`);

    const cacheData = await fs.readFile(cachePath, "utf-8");
    const parsedData = JSON.parse(cacheData);

    // Check if cache is still valid (less than 24 hours old)
    const cacheAge = Date.now() - parsedData.timestamp;
    if (cacheAge < 24 * 60 * 60 * 1000) {
      console.log(`Using cached data for ${url}`);
      return parsedData.data;
    }

    console.log(`Cache expired for ${url}`);
    return null;
  } catch (error) {
    // Cache miss or invalid cache
    return null;
  }
}

/**
 * Cache product data
 * @param {string} url - Product page URL
 * @param {object} data - Product data to cache
 * @returns {Promise<void>}
 */
async function cacheProduct(url, data) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });

    // Create a shortened hash to avoid filename length issues
    // Use the first 32 characters of the base64 hash
    const urlHash = crypto.createHash("md5").update(url).digest("hex");

    const cachePath = path.join(CACHE_DIR, `${urlHash}.json`);

    const cacheData = {
      timestamp: Date.now(),
      url: url, // Store the original URL for reference
      data,
    };

    await fs.writeFile(cachePath, JSON.stringify(cacheData, null, 2));
    console.log(`Cached data for ${url}`);
  } catch (error) {
    console.error("Error caching product data:", error);
  }
}

/**
 * Validate that scraped data contains all required fields
 * @param {object} data - Scraped product data
 * @throws {ScraperError} If required fields are missing
 */
function validateScrapedData(data) {
  // Basic validation - ensure we have at least title
  if (!data.title) {
    throw new ScraperError(`Product data incomplete. Missing title.`, 422);
  }
}

async function extractWeightSpecifically(page) {
  try {
    return await page.evaluate(() => {
      // Look specifically for weight information in various places

      // 1. Look in specification tables
      const specTables = document.querySelectorAll(
        'table, dl, div[class*="spec"], div[class*="detail"]'
      );
      for (const table of specTables) {
        // For tables
        if (table.tagName === "TABLE") {
          const rows = table.querySelectorAll("tr");
          for (const row of rows) {
            const cells = row.querySelectorAll("td, th");
            if (cells.length >= 2) {
              const label = cells[0].textContent.toLowerCase();
              if (
                label.includes("weight") ||
                label.includes("kg") ||
                label.includes("gram")
              ) {
                return cells[1].textContent.trim();
              }
            }
          }
        }

        // For definition lists
        if (table.tagName === "DL") {
          const terms = table.querySelectorAll("dt");
          for (const term of terms) {
            if (term.textContent.toLowerCase().includes("weight")) {
              const desc = term.nextElementSibling;
              if (desc && desc.tagName === "DD") {
                return desc.textContent.trim();
              }
            }
          }
        }

        // For div-based specs
        if (table.tagName === "DIV") {
          const text = table.textContent.toLowerCase();
          if (text.includes("weight")) {
            // Try to extract the weight value using regex
            const weightMatches = text.match(
              /weight[:\s-]*(\d+(?:\.\d+)?[\s]*(?:g|gram|kg|kilogram|gm|kgs))/i
            );
            if (weightMatches && weightMatches[1]) {
              return weightMatches[1].trim();
            }

            // If no regex match, try to find the value in nearby element
            const weightLabel = Array.from(table.querySelectorAll("*")).find(
              (el) =>
                el.textContent.toLowerCase().includes("weight") &&
                el.textContent.length < 30
            );

            if (weightLabel) {
              // Look for sibling or child elements that might contain the value
              const parent = weightLabel.parentElement;
              if (parent) {
                const siblings = Array.from(parent.children);
                const valueElement = siblings.find(
                  (el) =>
                    el !== weightLabel &&
                    /\d+/.test(el.textContent) &&
                    el.textContent.length < 30
                );

                if (valueElement) {
                  return valueElement.textContent.trim();
                }
              }
            }
          }
        }
      }

      // 2. Look for weight in product features/bullet points
      const bulletPoints = document.querySelectorAll(
        'li, div[class*="feature"], div[class*="bullet"]'
      );
      for (const point of bulletPoints) {
        const text = point.textContent.toLowerCase();
        if (
          text.includes("weight") ||
          text.includes(" kg") ||
          text.includes(" g ") ||
          text.includes("gram")
        ) {
          // Try to extract the weight value using regex
          const weightMatches = text.match(
            /(\d+(?:\.\d+)?[\s]*(?:g|gram|kg|kilogram|gm|kgs))/i
          );
          if (weightMatches && weightMatches[1]) {
            return text.trim();
          }
        }
      }

      // 3. Look for any text element that mentions weight with a number
      const allElements = document.querySelectorAll("*");
      for (const el of allElements) {
        const text = el.textContent.toLowerCase();
        if (
          (text.includes("weight") ||
            text.includes("kg") ||
            text.includes("gram")) &&
          text.length < 100 &&
          /\d+/.test(text)
        ) {
          // Try to extract weight value with regex
          const weightMatches = text.match(
            /(\d+(?:\.\d+)?[\s]*(?:g|gram|kg|kilogram|gm|kgs))/i
          );
          if (weightMatches && weightMatches[1]) {
            return text.trim();
          }
        }
      }

      // 4. For Flipkart specifically, check the product highlights
      const highlights = document.querySelectorAll("div._2418kt, ul._2-riNZ");
      for (const highlight of highlights) {
        const items = highlight.querySelectorAll("li");
        for (const item of items) {
          const text = item.textContent.toLowerCase();
          if (
            text.includes("weight") ||
            text.includes("kg") ||
            text.includes("gram")
          ) {
            return item.textContent.trim();
          }
        }
      }

      // 5. Look in product title for weight
      const productTitle = document.querySelector(
        "h1, .B_NuCI, ._30jeq3, .Wbt_B2"
      );
      if (productTitle) {
        const titleText = productTitle.textContent;
        const weightInTitle = titleText.match(
          /(\d+(?:\.\d+)?[\s]*(?:g|gram|kg|kilogram|gm|kgs))/i
        );
        if (weightInTitle && weightInTitle[1]) {
          return `Weight: ${weightInTitle[1]}`;
        }
      }

      return null;
    });
  } catch (error) {
    console.error("Error extracting weight specifically:", error);
    return null;
  }
}


/**
 * Main function to scrape product data
 * @param {string} url - Product page URL
 * @param {object} options - Scraping options
 * @returns {Promise<object>} Scraped product data
 */
async function scrapeProduct(url, options = {}) {
  // Set default options
  const opts = {
    bypassCache: false,
    headless: true,
    variants: {},
    checkDelivery: true,
    pincode: "201001", // Noida
    timeout: 60000,
    ...options,
  };

  // Check cache first
  if (!opts.bypassCache) {
    const cachedData = await getCachedProduct(url);
    if (cachedData) {
      return cachedData;
    }
  }

  // Launch browser
  const browser = await puppeteer.launch({
    headless: opts.headless ? "new" : false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
    defaultViewport: { width: 1366, height: 768 },
  });

  try {
    const page = await browser.newPage();

    // Set user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36"
    );

    // Navigate to product
    const platform = detectPlatform(url);
    console.log(`Navigating to ${platform} product: ${url}`);

    // Go to URL and wait for content to load
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: opts.timeout,
    });

    // Handle platform-specific obstacles (captchas, popups)
    await handlePlatformObstacles(page, platform);

    // Build inverted index of the page for better extraction
    console.log(`Building inverted index for ${platform}`);
    const pageIndex = await createInvertedIndex(page);

    // Select variants if specified
    if (opts.variants && Object.keys(opts.variants).length > 0) {
      await selectVariants(page, platform, opts.variants);
    }

    // Extract data using inverted index and AI
    let productData = await extractDataWithIndexAndAI(
      page,
      platform,
      pageIndex
    );

    // Extract weight specifically if it's missing
    if (!productData.weight) {
      console.log("Attempting specific weight extraction");
      const weightInfo = await extractWeightSpecifically(page);
      if (weightInfo) {
        productData.weight = weightInfo;
      }
    }

    // Check delivery for specified pincode if needed
    if (opts.checkDelivery) {
      const deliveryInfo = await checkDeliveryWithAI(
        page,
        platform,
        opts.pincode
      );
      if (deliveryInfo) {
        productData.delivery = deliveryInfo;
      }
    }

    // Fill missing data with AI if needed
    const hasMissingData =
      !productData.title ||
      !productData.price ||
      !productData.description ||
      !productData.weight ||
      productData.images?.length === 0;

    if (hasMissingData) {
      console.log(`Filling missing data with AI for ${platform}`);
      productData = await fillMissingDataWithAI(page, productData, pageIndex);
    }

    // Handle missing fields with defaults
    productData = handleMissingData(productData);

    // Add additional metadata
    productData.source = platform;
    productData.scrapedAt = new Date().toISOString();
    productData.originalUrl = url;

    // Validate data - throw error if critical data is missing
    validateScrapedData(productData);

    // Cache the result
    await cacheProduct(url, productData);
    console.log(`Scraped product data for ${platform}:`, productData);

    return productData;
  } catch (error) {
    if (error instanceof ScraperError) {
      throw error;
    } else {
      throw new ScraperError(`Error scraping product: ${error.message}`, 500);
    }
  } finally {
    await browser.close();
  }
}

module.exports = {
  scrapeProduct,
  ScraperError,
};