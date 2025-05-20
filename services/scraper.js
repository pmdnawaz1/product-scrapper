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
    const screenshotBase64 = screenshotBuffer.toString('base64');
    
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
      7. All product images URLs
      8. Delivery information
      9. Weight information (if available)
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
      
      If any information is missing, include the field with a null value.
      Make sure to capture ALL available data on the page - don't miss anything.
    `;
    
    try {
      const result = await geminiModel.generateContent({
        contents: [
          { role: "user", parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: screenshotBase64 } }
          ]}
        ]
      });
      
      const responseText = result.response.text();
      // Extract JSON from the response
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/{[\s\S]*}/);
      
      if (jsonMatch) {
        const parsedData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        return {
          ...parsedData,
          source: platform
        };
      }
    } catch (aiError) {
      console.error('Error with Gemini AI call:', aiError);
      // Try with a different model or format if available
      try {
        // Simplified prompt without image for text-only models
        const textOnlyModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const textResult = await textOnlyModel.generateContent({
          contents: [
            { role: "user", parts: [
              { text: `Extract product data from this HTML: ${pageContent.substring(0, 20000)}` }
            ]}
          ]
        });
        
        const textResponseText = textResult.response.text();
        const textJsonMatch = textResponseText.match(/```json\n([\s\S]*?)\n```/) || 
                         textResponseText.match(/{[\s\S]*}/);
        
        if (textJsonMatch) {
          const parsedData = JSON.parse(textJsonMatch[1] || textJsonMatch[0]);
          return {
            ...parsedData,
            source: platform
          };
        }
      } catch (textAiError) {
        console.error('Text-only AI model also failed:', textAiError);
      }
    }
    
    throw new Error('No valid JSON found in AI response');
  } catch (error) {
    console.error('Error extracting data with AI:', error);
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
          
          // Image elements
          if (targetType === 'images') {
            if (index.tagNames['img']) {
              index.tagNames['img'].forEach(xpath => {
                const element = getElementByXPath(xpath);
                if (element && element.src) {
                  // Prioritize larger images
                  const width = element.width || 0;
                  const height = element.height || 0;
                  const size = width * height;
                  
                  potentialElements.push({
                    element,
                    xpath,
                    score: size > 10000 ? 4 : 2,
                    url: element.src
                  });
                }
              });
            }
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
      
      // Extract images
      const imageCandidates = findPotentialElements('images');
      imageCandidates.sort((a, b) => b.score - a.score);
      data.images = imageCandidates.slice(0, 5).map(img => img.url);
      
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
    
    // Extract main image
    const mainImages = await page.evaluate(() => {
      // Find largest images
      const images = Array.from(document.querySelectorAll('img'))
        .filter(img => img.src && !img.src.includes('data:image') && !img.src.includes('base64'))
        .map(img => ({
          src: img.src,
          width: img.width || 0,
          height: img.height || 0,
          area: (img.width || 0) * (img.height || 0)
        }));
      
      // Sort by area (largest first)
      images.sort((a, b) => b.area - a.area);
      
      return images.slice(0, 3).map(img => img.src);
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
async function fillMissingDataWithAI(page, productData, pageIndex) {
  // Check which critical fields are missing
  const missingFields = [];
  
  if (!productData.title) missingFields.push('title');
  if (!productData.price) missingFields.push('price');
  if (!productData.description) missingFields.push('description');
  if (!productData.weight) missingFields.push('weight');
  if (!productData.category) missingFields.push('category');
  if (productData.images?.length === 0) missingFields.push('images');
  
  // If nothing is missing, return as is
  if (missingFields.length === 0) {
    return productData;
  }
  
  console.log(`Need to fill missing fields: ${missingFields.join(', ')}`);
  
  try {
    // Capture page content and screenshot
    const pageContent = await page.content();
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const screenshotBase64 = screenshotBuffer.toString('base64');
    
    // Create a prompt for Gemini
    const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `
      I need your help finding specific missing product information on an e-commerce page.
      
      The page is from ${productData.source} and I've already extracted some information:
      ${Object.entries(productData)
        .filter(([key, value]) => value && key !== 'source')
        .map(([key, value]) => `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
        .join('\n')
      }
      
      I'm missing the following fields: ${missingFields.join(', ')}
      
      For each missing field, tell me exactly where to find it on the page.
      1. Describe the element's position visually
      2. What text or visual cue would help identify it
      3. Is it near any known information I already have
      
      For each field, also provide the actual value you can see in the image.
      
      Return your answer as a JSON object with only the missing fields.
    `;
    
    // Send to Gemini for analysis
    try {
      const result = await geminiModel.generateContent({
        contents: [
          { role: "user", parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: screenshotBase64 } }
          ]}
        ]
      });
      
      // Extract JSON response
      const responseText = result.response.text();
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                        responseText.match(/{[\s\S]*}/);
      
      if (jsonMatch) {
        const missingData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        
        // Merge with existing data
        return {
          ...productData,
          ...missingData,
          // Special handling for arrays and objects
          images: [...(productData.images || []), ...(missingData.images || [])],
          variants: {
            ...(productData.variants || {}),
            ...(missingData.variants || {})
          }
        };
      }
    } catch (aiError) {
      console.error('Error filling missing data with Gemini Vision:', aiError);
      
      // Try with text-only model as fallback
      try {
        const textModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const textPrompt = `
          Extract this specific missing product information: ${missingFields.join(', ')}
          From this HTML content. Return only a JSON object with these fields.
        `;
        
        const textResult = await textModel.generateContent({
          contents: [
            { role: "user", parts: [
              { text: textPrompt + "\n\n" + pageContent.substring(0, 20000) }
            ]}
          ]
        });
        
        const textResponse = textResult.response.text();
        const textJsonMatch = textResponse.match(/```json\n([\s\S]*?)\n```/) || 
                          textResponse.match(/{[\s\S]*}/);
        
        if (textJsonMatch) {
          const textMissingData = JSON.parse(textJsonMatch[1] || textJsonMatch[0]);
          return {
            ...productData,
            ...textMissingData
          };
        }
      } catch (textError) {
        console.error('Text-only model also failed:', textError);
      }
    }
    
    // If we couldn't parse JSON, return original data
    return productData;
  } catch (error) {
    console.error('Error filling missing data with AI:', error);
    return productData;
  }
}

/**
 * Check delivery availability using AI
 * @param {object} page - Puppeteer page object
 * @param {string} platform - E-commerce platform name
 * @param {string} pincode - Delivery pincode to check
 * @param {object} pageIndex - Inverted index of page elements
 * @returns {Promise<object>} Delivery information
 */
async function checkDeliveryWithAI(page, platform, pincode, pageIndex) {
  console.log(`Checking delivery for pincode ${pincode} on ${platform}`);
  
  try {
    // First try a simple approach without AI
    const deliveryResult = await page.evaluate(async (pincode, platform) => {
      // Look for pincode input fields
      const pincodeInputs = Array.from(document.querySelectorAll('input'))
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
      
      if (pincodeInputs.length > 0) {
        // Found a pincode input, now fill it
        const input = pincodeInputs[0];
        input.value = pincode;
        
        // Try to find and click a check button
        const parent = input.closest('div') || input.parentElement;
        if (parent) {
          // Look for check button
          const checkButtons = Array.from(parent.querySelectorAll('button'))
            .filter(btn => {
              const text = btn.textContent.toLowerCase().trim();
              return text.includes('check') || 
                     text.includes('apply') || 
                     text.includes('submit') ||
                     text.includes('go');
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
      
      // Platform-specific approaches
      if (platform === 'flipkart') {
        const pincodeTexts = Array.from(document.querySelectorAll('*'))
          .filter(el => el.textContent.toLowerCase().includes('pincode'));
        
        if (pincodeTexts.length > 0) {
          pincodeTexts[0].click();
          await new Promise(r => setTimeout(r, 500));
          
          const inputs = document.querySelectorAll('input');
          const pincodeInput = Array.from(inputs).find(input => 
            input.placeholder && (
              input.placeholder.toLowerCase().includes('pin') || 
              input.placeholder.includes('enter')
            )
          );
          
          if (pincodeInput) {
            pincodeInput.value = pincode;
            
            const checkBtns = Array.from(document.querySelectorAll('button'))
              .filter(btn => btn.textContent.toLowerCase().includes('check'));
            
            if (checkBtns.length > 0) {
              checkBtns[0].click();
              return true;
            }
          }
        }
      }
      
      return false;
    }, pincode, platform);
    
    // Wait for delivery check to update the page
    await wait(page, 3000);
    
    // Now try to extract delivery information using Gemini 1.5
    try {
      const screenshotBuffer = await page.screenshot({ fullPage: false }); // Capture just visible part
      const screenshotBase64 = screenshotBuffer.toString('base64');
      
      const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const deliveryPrompt = `
        I need to extract delivery information for pincode ${pincode} on this ${platform} e-commerce page.
        
        Look at the page and tell me:
        1. Is delivery available to pincode ${pincode}? (true/false)
        2. What is the estimated delivery date or time frame?
        3. Are there any delivery charges?
        
        Return the information as a JSON object with these fields:
        {
          "available": boolean,
          "estimatedDate": "string with delivery date/timeframe",
          "charges": "string with delivery fee or 'Free'"
        }
      `;
      
      const deliveryResult = await geminiModel.generateContent({
        contents: [
          { role: "user", parts: [
            { text: deliveryPrompt },
            { inlineData: { mimeType: "image/jpeg", data: screenshotBase64 } }
          ]}
        ]
      });
      
      const deliveryText = deliveryResult.response.text();
      const jsonMatch = deliveryText.match(/```json\n([\s\S]*?)\n```/) || 
                        deliveryText.match(/{[\s\S]*}/);
      
      if (jsonMatch) {
        const deliveryInfo = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        return {
          available: deliveryInfo.available,
          estimatedDate: deliveryInfo.estimatedDate,
          charges: deliveryInfo.charges,
          pincode: pincode
        };
      }
    } catch (aiError) {
      console.error('Gemini delivery extraction failed:', aiError);
      // Continue to fallback approach
    }
    
    // Fallback: extract delivery information using standard DOM approach
    const deliveryInfo = await page.evaluate((pincode) => {
      // Look for delivery text on the page
      const deliveryTexts = Array.from(document.querySelectorAll('*'))
        .filter(el => {
          const text = el.textContent.toLowerCase();
          return (text.includes('deliver') || 
                  text.includes('shipping') || 
                  text.includes('dispatch')) && 
                 text.length < 200;
        })
        .map(el => el.textContent.trim());
      
      // Extract delivery availability
      const available = !deliveryTexts.some(text => 
        text.includes('not available') || 
        text.includes('unavailable') || 
        text.includes('cannot be delivered')
      );
      
      // Extract estimated date
      let estimatedDate = null;
      for (const text of deliveryTexts) {
        if (text.includes('by') || text.includes('on') || text.includes('expected')) {
          const dateMatch = text.match(/\b(\d{1,2}(st|nd|rd|th)?\s+\w+|\w+\s+\d{1,2}(st|nd|rd|th)?)\b/);
          if (dateMatch) {
            estimatedDate = dateMatch[0];
            break;
          }
          
          // Look for text that might contain a date
          if (text.includes('day') || text.includes('week')) {
            estimatedDate = text;
            break;
          }
        }
      }
      
      // Extract delivery charges
      let charges = null;
      for (const text of deliveryTexts) {
        if (text.includes('free')) {
          charges = 'Free';
          break;
        }
        
        const chargeMatch = text.match(/(₹|RS\.|\$|€|£)\s*\d+(\.\d+)?/);
        if (chargeMatch) {
          charges = chargeMatch[0];
          break;
        }
      }
      
      return {
        available,
        estimatedDate,
        charges,
        pincode
      };
    }, pincode);
    
    return deliveryInfo;
  } catch (error) {
    console.error('Error checking delivery with AI:', error);
    return {
      available: null,
      estimatedDate: null,
      charges: null,
      pincode: pincode
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
      
      const selected = await page.evaluate((variantType, variantValue) => {
        // Find elements that match the variant type
        const variantTypeElements = Array.from(document.querySelectorAll('*'))
          .filter(el => {
            const text = el.textContent.toLowerCase();
            return text.includes(variantType.toLowerCase());
          });
        
        // Find elements that match the variant value
        const variantValueElements = Array.from(document.querySelectorAll('*'))
          .filter(el => {
            const text = el.textContent.toLowerCase().trim();
            return text === variantValue.toLowerCase();
          });
        
        // Look for elements with the exact value
        if (variantValueElements.length > 0) {
          for (const element of variantValueElements) {
            // Check if it's clickable
            if (element.tagName === 'BUTTON' || 
                element.tagName === 'LI' || 
                element.tagName === 'DIV' || 
                element.tagName === 'OPTION' ||
                element.getAttribute('role') === 'button') {
              element.click();
              return true;
            }
            
            // Check parent for clickability
            const parent = element.parentElement;
            if (parent && (
                parent.tagName === 'BUTTON' || 
                parent.tagName === 'LI' || 
                parent.tagName === 'DIV' ||
                parent.getAttribute('role') === 'button')) {
              parent.click();
              return true;
            }
          }
        }
        
        // If not found, try finding variant options near variant type labels
        if (variantTypeElements.length > 0) {
          for (const element of variantTypeElements) {
            const parent = element.closest('div') || element.parentElement;
            if (!parent) continue;
            
            // Look for clickable elements with matching value
            const options = parent.querySelectorAll('button, li, div[role="button"], span');
            for (const option of options) {
              if (option.textContent.toLowerCase().trim() === variantValue.toLowerCase()) {
                option.click();
                return true;
              }
            }
          }
        }
        
        // As a last resort, try to find any elements that contain the value
        const potentialVariants = Array.from(document.querySelectorAll('button, li, div[role="button"], span'))
          .filter(el => el.textContent.toLowerCase().trim() === variantValue.toLowerCase());
        
        if (potentialVariants.length > 0) {
          potentialVariants[0].click();
          return true;
        }
        
        return false;
      }, variantType, variantValue);
      
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
    title: productData.title || 'Unknown Product',
    price: productData.price || null,
    originalPrice: productData.originalPrice || null,
    description: productData.description || 'No description available',
    features: Array.isArray(productData.features) ? productData.features : [],
    variants: {
      sizes: Array.isArray(productData.variants?.sizes) ? productData.variants.sizes : [],
      colors: Array.isArray(productData.variants?.colors) ? productData.variants.colors : [],
      other: Array.isArray(productData.variants?.other) ? productData.variants.other : []
    },
    images: Array.isArray(productData.images) ? productData.images : [],
    delivery: {
      available: productData.delivery?.available ?? null,
      estimatedDate: productData.delivery?.estimatedDate || null,
      charges: productData.delivery?.charges || null,
      pincode: productData.delivery?.pincode || '201001'
    },
    weight: productData.weight || null,
    category: productData.category || 'Uncategorized',
    source: productData.source || null,
    scrapedAt: productData.scrapedAt || new Date().toISOString(),
    originalUrl: productData.originalUrl || null
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
    const urlHash = crypto
      .createHash('md5')
      .update(url)
      .digest('hex');
    
    const cachePath = path.join(CACHE_DIR, `${urlHash}.json`);
    
    const cacheData = await fs.readFile(cachePath, 'utf-8');
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
    const urlHash = crypto
      .createHash('md5')
      .update(url)
      .digest('hex');
    
    const cachePath = path.join(CACHE_DIR, `${urlHash}.json`);
    
    const cacheData = {
      timestamp: Date.now(),
      url: url, // Store the original URL for reference
      data
    };
    
    await fs.writeFile(cachePath, JSON.stringify(cacheData, null, 2));
    console.log(`Cached data for ${url}`);
  } catch (error) {
    console.error('Error caching product data:', error);
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
    throw new ScraperError(
      `Product data incomplete. Missing title.`,
      422
    );
  }
}

/**
 * Main function to scrape product data
 * @param {string} url - Product page URL
 * @param {object} options - Scraping options
 * @returns {Promise<object>} Scraped product data
 */
async function scrapeProduct(url, options = {}) {
  // console.log(`Scraping product: ${url}`);
  
  // Set default options
  const opts = {
    bypassCache: false,
    headless: true,
    variants: {},
    checkDelivery: true,
    pincode: '201001', // Noida
    timeout: 60000,
    ...options
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
    headless: opts.headless ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1366, height: 768 }
  });
  
  try {
    const page = await browser.newPage();
    
    // Set user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36'
    );
    
    // Navigate to product
    const platform = detectPlatform(url);
    console.log(`Navigating to ${platform} product: ${url}`);
    
    // Go to URL and wait for content to load
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: opts.timeout 
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
    let productData = await extractDataWithIndexAndAI(page, platform, pageIndex);
    
    // Check delivery for specified pincode if needed
    if (opts.checkDelivery) {
      const deliveryInfo = await checkDeliveryWithAI(page, platform, opts.pincode, pageIndex);
      if (deliveryInfo) {
        productData.delivery = deliveryInfo;
      }
    }
    
    // Fill missing data with AI if needed
    const hasMissingData = !productData.title || 
                          !productData.price || 
                          !productData.description || 
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
      throw new ScraperError(
        `Error scraping product: ${error.message}`,
        500
      );
    }
  } finally {
    await browser.close();
  }
}

module.exports = {
  scrapeProduct,
  ScraperError
};