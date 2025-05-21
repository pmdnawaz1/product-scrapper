// /**
//  * Improved function to extract product variants (colors, sizes, etc.)
//  * @param {object} page - Puppeteer page object
//  * @param {string} platform - E-commerce platform name
//  * @returns {Promise<object>} Extracted variants
//  */
// async function extractProductVariants(page, platform) {
//     console.log(`Extracting variants for ${platform}`);
    
//     try {
//       // Platform-specific extraction methods
//       if (platform === 'flipkart') {
//         return await extractFlipkartVariants(page);
//       } else if (platform === 'amazon') {
//         return await extractAmazonVariants(page);
//       } else if (platform === 'myntra') {
//         return await extractMyntraVariants(page);
//       } else if (platform === 'snapdeal') {
//         return await extractSnapdealVariants(page);
//       } else {
//         // Generic variant extraction for other platforms
//         return await extractGenericVariants(page);
//       }
//     } catch (error) {
//       console.error(`Error extracting variants:`, error);
//       return {
//         sizes: [],
//         colors: [],
//         other: []
//       };
//     }
//   }
  
//   /**
//    * Extract variants specifically from Flipkart
//    * @param {object} page - Puppeteer page object
//    * @returns {Promise<object>} Variants information
//    */
//   async function extractFlipkartVariants(page) {
//     return await page.evaluate(() => {
//       const variants = {
//         sizes: [],
//         colors: [],
//         other: []
//       };
      
//       // Method 1: Look for color/size selection buttons
//       // Check common Flipkart color selectors
//       const colorSelectors = [
//         'div._1q8vht4, div._2OTVHf, div._3Oikkn, div._2C41yO',
//         'ul._1q8vht4 li, ul._2OTVHf li, ul._3Oikkn li',
//         'div[id*="color"] button, div[id*="COLOR"] button',
//         'div._3Oikkn, div._2OTVHf'
//       ];
      
//       // Try each selector
//       for (const selector of colorSelectors) {
//         try {
//           const colorElements = document.querySelectorAll(selector);
//           if (colorElements && colorElements.length > 0) {
//             // Look for color elements with titles or color indicators
//             Array.from(colorElements).forEach(element => {
//               // Check if it's a color element
//               const style = window.getComputedStyle(element);
//               const backgroundColor = style.backgroundColor;
//               const borderColor = style.borderColor;
//               const backgroundImage = style.backgroundImage;
              
//               // Get color name from various attributes
//               let colorName = element.getAttribute('title') || 
//                             element.getAttribute('data-color') || 
//                             element.getAttribute('data-value') ||
//                             element.textContent.trim();
                            
//               // If still no color name but has background color, use that
//               if ((!colorName || colorName === '') && 
//                   (backgroundColor !== 'transparent' && backgroundColor !== 'rgba(0, 0, 0, 0)')) {
//                 colorName = backgroundColor;
//               }
              
//               // If found a color and it's not already in the list
//               if (colorName && colorName !== '' && !variants.colors.includes(colorName)) {
//                 variants.colors.push(colorName);
//               }
//             });
            
//             // If we found some colors, break out of the loop
//             if (variants.colors.length > 0) {
//               break;
//             }
//           }
//         } catch (e) {
//           // Ignore errors and try the next selector
//         }
//       }
      
//       // Check for size selectors
//       const sizeSelectors = [
//         'div._1q8vht4 div, div._3Oikkn div, div._2OTVHf div',
//         'ul._1q8vht4 li, ul._3Oikkn li, ul._2OTVHf li',
//         'div[id*="size"] button, div[id*="SIZE"] button',
//         'a[data-size], div[data-size]'
//       ];
      
//       for (const selector of sizeSelectors) {
//         try {
//           const sizeElements = document.querySelectorAll(selector);
//           if (sizeElements && sizeElements.length > 0) {
//             // Get all size values
//             Array.from(sizeElements).forEach(element => {
//               const sizeText = element.textContent.trim();
//               // Check if it looks like a size (usually short text)
//               if (sizeText && sizeText.length < 10 && !variants.sizes.includes(sizeText)) {
//                 variants.sizes.push(sizeText);
//               }
//             });
            
//             // If found sizes, break out
//             if (variants.sizes.length > 0) {
//               break;
//             }
//           }
//         } catch (e) {
//           // Ignore errors and try the next selector
//         }
//       }
      
//       // Method 2: Look for variant selection section headers
//       const variantSectionLabels = Array.from(document.querySelectorAll('div._2OvUl0, div._1EDlbo, div._2C41yO, div._3Oikkn'))
//         .filter(div => div.textContent.trim().length < 30); // Usually short headers
        
//       for (const label of variantSectionLabels) {
//         const labelText = label.textContent.toLowerCase().trim();
        
//         // Find the closest container that might have variant options
//         const parent = label.closest('div');
//         if (!parent) continue;
        
//         // Look for option elements in the parent
//         const optionElements = parent.querySelectorAll('div, li, button, a');
//         const options = Array.from(optionElements)
//           .map(el => el.textContent.trim())
//           .filter(text => text && text.length > 0 && text.length < 30 && text !== labelText);
        
//         // Assign to appropriate variant type
//         if (labelText.includes('color') || labelText.includes('colour')) {
//           variants.colors = [...variants.colors, ...options];
//         } else if (labelText.includes('size')) {
//           variants.sizes = [...variants.sizes, ...options];
//         } else if (options.length > 0) {
//           variants.other = [...variants.other, ...options];
//         }
//       }
      
//       // Method 3: Check for dropdowns
//       const dropdowns = document.querySelectorAll('select');
//       for (const dropdown of dropdowns) {
//         const options = Array.from(dropdown.querySelectorAll('option'))
//           .map(option => option.textContent.trim())
//           .filter(text => text && text.length > 0);
          
//         if (options.length > 0) {
//           // Try to determine what type of variant this is
//           const label = dropdown.getAttribute('aria-label') || 
//                        dropdown.getAttribute('name') || 
//                        dropdown.getAttribute('id') || '';
                       
//           if (label.toLowerCase().includes('color') || label.toLowerCase().includes('colour')) {
//             variants.colors = [...variants.colors, ...options];
//           } else if (label.toLowerCase().includes('size')) {
//             variants.sizes = [...variants.sizes, ...options];
//           } else {
//             variants.other = [...variants.other, ...options];
//           }
//         }
//       }
      
//       // Method 4: Parse product title for variants
//       const productTitle = document.querySelector('h1, .B_NuCI, ._30jeq3');
//       if (productTitle) {
//         const titleText = productTitle.textContent;
        
//         // Look for color in title (often in parentheses or after comma)
//         const colorInTitle = titleText.match(/\(([^)]*(?:color|colour)[^)]*)\)/i) || 
//                              titleText.match(/,\s*([^,]*(?:color|colour)[^,]*)/i);
                             
//         if (colorInTitle && colorInTitle[1]) {
//           const colorText = colorInTitle[1].replace(/color|colour/i, '').trim();
//           if (colorText && !variants.colors.includes(colorText)) {
//             variants.colors.push(colorText);
//           }
//         }
//       }
      
//       // Remove duplicates and clean up
//       variants.colors = [...new Set(variants.colors)];
//       variants.sizes = [...new Set(variants.sizes)];
//       variants.other = [...new Set(variants.other)];
      
//       return variants;
//     });
//   }
  
//   /**
//    * Extract variants specifically from Amazon
//    * @param {object} page - Puppeteer page object
//    * @returns {Promise<object>} Variants information
//    */
//   async function extractAmazonVariants(page) {
//     return await page.evaluate(() => {
//       const variants = {
//         sizes: [],
//         colors: [],
//         other: []
//       };
      
//       // Method 1: Check for color swatch elements
//       const colorSwatches = document.querySelectorAll('#variation_color_name li, #color-chooser li, .colorSwatchWrapper li');
//       if (colorSwatches && colorSwatches.length > 0) {
//         colorSwatches.forEach(swatch => {
//           const colorName = swatch.getAttribute('title') || 
//                            swatch.getAttribute('data-name') || 
//                            swatch.getAttribute('data-color') ||
//                            swatch.textContent.trim();
                           
//           if (colorName && colorName.includes('Click to select ')) {
//             const cleanName = colorName.replace('Click to select ', '');
//             if (!variants.colors.includes(cleanName)) {
//               variants.colors.push(cleanName);
//             }
//           } else if (colorName && !variants.colors.includes(colorName)) {
//             variants.colors.push(colorName);
//           }
//         });
//       }
      
//       // Method 2: Check for size options
//       const sizeOptions = document.querySelectorAll('#variation_size_name li, #size-chooser li, .sizeSwatchWrapper li');
//       if (sizeOptions && sizeOptions.length > 0) {
//         sizeOptions.forEach(option => {
//           const sizeName = option.getAttribute('title') || 
//                           option.getAttribute('data-name') || 
//                           option.getAttribute('data-size') ||
//                           option.textContent.trim();
                          
//           if (sizeName && sizeName.includes('Click to select ')) {
//             const cleanName = sizeName.replace('Click to select ', '');
//             if (!variants.sizes.includes(cleanName)) {
//               variants.sizes.push(cleanName);
//             }
//           } else if (sizeName && !variants.sizes.includes(sizeName)) {
//             variants.sizes.push(sizeName);
//           }
//         });
//       }
      
//       // Method 3: Check dropdown options
//       const dropdowns = document.querySelectorAll('select');
//       for (const dropdown of dropdowns) {
//         const options = Array.from(dropdown.querySelectorAll('option'))
//           .map(option => option.textContent.trim())
//           .filter(text => text && text !== 'Select' && text.length > 0);
          
//         if (options.length > 0) {
//           const label = dropdown.getAttribute('aria-label') || 
//                        dropdown.getAttribute('name') || 
//                        dropdown.getAttribute('id') || '';
                       
//           if (label.toLowerCase().includes('color')) {
//             variants.colors = [...variants.colors, ...options];
//           } else if (label.toLowerCase().includes('size')) {
//             variants.sizes = [...variants.sizes, ...options];
//           } else {
//             variants.other = [...variants.other, ...options];
//           }
//         }
//       }
      
//       // Method 4: Look for twister data in script tags (Amazon specific)
//       try {
//         const scripts = document.querySelectorAll('script');
//         let twisterData = null;
        
//         for (const script of scripts) {
//           const content = script.textContent;
//           if (content && content.includes('colorToAsin') || content.includes('twisterData')) {
//             // Try to extract color and size data from JSON
//             const jsonMatch = content.match(/var\s+twisterData\s*=\s*(\{.*?\});/);
//             if (jsonMatch && jsonMatch[1]) {
//               try {
//                 twisterData = JSON.parse(jsonMatch[1]);
//                 break;
//               } catch (e) {
//                 // Ignore parsing errors
//               }
//             }
//           }
//         }
        
//         if (twisterData && twisterData.dimensions) {
//           for (const dimension of twisterData.dimensions) {
//             if (dimension.name.toLowerCase().includes('color')) {
//               dimension.values.forEach(value => {
//                 if (value.displayValue && !variants.colors.includes(value.displayValue)) {
//                   variants.colors.push(value.displayValue);
//                 }
//               });
//             } else if (dimension.name.toLowerCase().includes('size')) {
//               dimension.values.forEach(value => {
//                 if (value.displayValue && !variants.sizes.includes(value.displayValue)) {
//                   variants.sizes.push(value.displayValue);
//                 }
//               });
//             } else {
//               dimension.values.forEach(value => {
//                 if (value.displayValue && !variants.other.includes(value.displayValue)) {
//                   variants.other.push(value.displayValue);
//                 }
//               });
//             }
//           }
//         }
//       } catch (e) {
//         // Ignore errors in JSON parsing
//       }
      
//       // Remove duplicates
//       variants.colors = [...new Set(variants.colors)];
//       variants.sizes = [...new Set(variants.sizes)];
//       variants.other = [...new Set(variants.other)];
      
//       return variants;
//     });
//   }
  
//   /**
//    * Extract variants specifically from Myntra
//    * @param {object} page - Puppeteer page object
//    * @returns {Promise<object>} Variants information
//    */
//   async function extractMyntraVariants(page) {
//     return await page.evaluate(() => {
//       const variants = {
//         sizes: [],
//         colors: [],
//         other: []
//       };
      
//       // Method 1: Check for size buttons
//       const sizeButtons = document.querySelectorAll('div.size-buttons-tippy-container button, div.size-buttons button');
//       if (sizeButtons && sizeButtons.length > 0) {
//         sizeButtons.forEach(button => {
//           const sizeText = button.textContent.trim();
//           if (sizeText && !variants.sizes.includes(sizeText)) {
//             variants.sizes.push(sizeText);
//           }
//         });
//       }
      
//       // Method 2: Check for color options
//       const colorOptions = document.querySelectorAll('div.colors-container > div, div.color-palette > div');
//       if (colorOptions && colorOptions.length > 0) {
//         colorOptions.forEach(option => {
//           const colorName = option.getAttribute('title') || 
//                            option.getAttribute('data-color') ||
//                            option.getAttribute('aria-label');
                           
//           if (colorName && !variants.colors.includes(colorName)) {
//             variants.colors.push(colorName);
//           }
//         });
//       }
      
//       // Method 3: Look for more structured color/size options
//       const optionsContainers = document.querySelectorAll('div.options-container');
//       for (const container of optionsContainers) {
//         const headerElement = container.querySelector('h4.title-container, div.title-container');
//         if (!headerElement) continue;
        
//         const headerText = headerElement.textContent.toLowerCase().trim();
//         const optionElements = container.querySelectorAll('button, div[role="button"]');
        
//         if (optionElements && optionElements.length > 0) {
//           const options = Array.from(optionElements)
//             .map(el => el.textContent.trim())
//             .filter(text => text && text.length > 0);
            
//           if (headerText.includes('size')) {
//             variants.sizes = [...variants.sizes, ...options];
//           } else if (headerText.includes('color')) {
//             variants.colors = [...variants.colors, ...options];
//           } else {
//             variants.other = [...variants.other, ...options];
//           }
//         }
//       }
      
//       // Method 4: Look for product info section that might mention variants
//       const productInfoSection = document.querySelector('div.style-descriptor');
//       if (productInfoSection) {
//         const infoText = productInfoSection.textContent;
        
//         // Try to extract color from product info
//         const colorMatch = infoText.match(/colou?r\s*:\s*([^,\n]+)/i);
//         if (colorMatch && colorMatch[1] && !variants.colors.includes(colorMatch[1].trim())) {
//           variants.colors.push(colorMatch[1].trim());
//         }
//       }
      
//       // Remove duplicates
//       variants.colors = [...new Set(variants.colors)];
//       variants.sizes = [...new Set(variants.sizes)];
//       variants.other = [...new Set(variants.other)];
      
//       return variants;
//     });
//   }
  
//   /**
//    * Extract variants specifically from Snapdeal
//    * @param {object} page - Puppeteer page object
//    * @returns {Promise<object>} Variants information
//    */
//   async function extractSnapdealVariants(page) {
//     return await page.evaluate(() => {
//       const variants = {
//         sizes: [],
//         colors: [],
//         other: []
//       };
      
//       // Method 1: Check for size selection elements
//       const sizeElements = document.querySelectorAll('div.size-selection li, div.size-option-list li');
//       if (sizeElements && sizeElements.length > 0) {
//         sizeElements.forEach(element => {
//           const sizeText = element.textContent.trim();
//           if (sizeText && !variants.sizes.includes(sizeText)) {
//             variants.sizes.push(sizeText);
//           }
//         });
//       }
      
//       // Method 2: Check for color selection elements
//       const colorElements = document.querySelectorAll('div.color-selection li, div.color-option-list li');
//       if (colorElements && colorElements.length > 0) {
//         colorElements.forEach(element => {
//           const colorText = element.getAttribute('data-color') || 
//                            element.getAttribute('title') ||
//                            element.textContent.trim();
                           
//           if (colorText && !variants.colors.includes(colorText)) {
//             variants.colors.push(colorText);
//           }
//         });
//       }
      
//       // Method 3: Look for variant section headers
//       const variantSections = document.querySelectorAll('div.product-option');
//       for (const section of variantSections) {
//         const headerElement = section.querySelector('div.option-title, div.option-head');
//         if (!headerElement) continue;
        
//         const headerText = headerElement.textContent.toLowerCase().trim();
//         const optionElements = section.querySelectorAll('li, span.option');
        
//         if (optionElements && optionElements.length > 0) {
//           const options = Array.from(optionElements)
//             .map(el => el.textContent.trim())
//             .filter(text => text && text.length > 0);
            
//           if (headerText.includes('size')) {
//             variants.sizes = [...variants.sizes, ...options];
//           } else if (headerText.includes('color')) {
//             variants.colors = [...variants.colors, ...options];
//           } else {
//             variants.other = [...variants.other, ...options];
//           }
//         }
//       }
      
//       // Method 4: Check for specific variant HTML structure
//       const variantBoxes = document.querySelectorAll('div.attr-box');
//       for (const box of variantBoxes) {
//         const labelElement = box.querySelector('div.attr-name');
//         if (!labelElement) continue;
        
//         const labelText = labelElement.textContent.toLowerCase().trim();
//         const valueElements = box.querySelectorAll('span.attr-val');
        
//         if (valueElements && valueElements.length > 0) {
//           const values = Array.from(valueElements)
//             .map(el => el.textContent.trim())
//             .filter(text => text && text.length > 0);
            
//           if (labelText.includes('size')) {
//             variants.sizes = [...variants.sizes, ...values];
//           } else if (labelText.includes('color')) {
//             variants.colors = [...variants.colors, ...values];
//           } else {
//             variants.other = [...variants.other, ...values];
//           }
//         }
//       }
      
//       // Remove duplicates
//       variants.colors = [...new Set(variants.colors)];
//       variants.sizes = [...new Set(variants.sizes)];
//       variants.other = [...new Set(variants.other)];
      
//       return variants;
//     });
//   }
  
//   /**
//    * Generic variant extraction for other platforms
//    * @param {object} page - Puppeteer page object
//    * @returns {Promise<object>} Variants information
//    */
//   async function extractGenericVariants(page) {
//     return await page.evaluate(() => {
//       const variants = {
//         sizes: [],
//         colors: [],
//         other: []
//       };
      
//       // Method 1: Look for elements containing color/size labels
//       const allElements = document.querySelectorAll('*');
//       const variantLabels = Array.from(allElements)
//         .filter(el => {
//           const text = el.textContent.toLowerCase();
//           return (text.includes('color') || text.includes('colour') || 
//                   text.includes('size') || text.includes('variant') ||
//                   text.includes('option')) && 
//                  text.length < 100; // Labels are usually short
//         });
      
//       for (const label of variantLabels) {
//         const labelText = label.textContent.toLowerCase();
        
//         // Find the closest container that might have variant options
//         let container = label.nextElementSibling;
//         if (!container) {
//           container = label.parentElement;
//         }
        
//         if (container) {
//           // Look for option elements (buttons, list items, etc.)
//           const optionElements = container.querySelectorAll('button, li, div[role="button"], a.option, span.option');
//           if (optionElements && optionElements.length > 0) {
//             const options = Array.from(optionElements)
//               .map(el => el.textContent.trim())
//               .filter(text => text && text.length > 0 && text.length < 30); // Variant options are usually short
            
//             if (labelText.includes('color') || labelText.includes('colour')) {
//               variants.colors = [...variants.colors, ...options];
//             } else if (labelText.includes('size')) {
//               variants.sizes = [...variants.sizes, ...options];
//             } else {
//               variants.other = [...variants.other, ...options];
//             }
//           }
//         }
//       }
      
//       // Method 2: Check for select dropdowns
//       const dropdowns = document.querySelectorAll('select');
//       for (const dropdown of dropdowns) {
//         const options = Array.from(dropdown.querySelectorAll('option'))
//           .map(option => option.textContent.trim())
//           .filter(text => text && text !== 'Select' && text.length > 0);
          
//         if (options.length > 0) {
//           const label = dropdown.getAttribute('aria-label') || 
//                         dropdown.getAttribute('name') || 
//                         dropdown.getAttribute('id') || 
//                         dropdown.parentElement?.textContent || '';
                       
//           if (label.toLowerCase().includes('color') || label.toLowerCase().includes('colour')) {
//             variants.colors = [...variants.colors, ...options];
//           } else if (label.toLowerCase().includes('size')) {
//             variants.sizes = [...variants.sizes, ...options];
//           } else {
//             variants.other = [...variants.other, ...options];
//           }
//         }
//       }
      
//       // Method 3: Look for color swatches or color pickers
//       const colorElements = document.querySelectorAll('[class*="color"], [class*="colour"], [id*="color"], [id*="colour"]');
//       for (const element of colorElements) {
//         // Skip containers and only look at selectable elements
//         if (element.children.length > 5) continue;
        
//         // Check for color indicators
//         const style = window.getComputedStyle(element);
//         if (style.backgroundColor !== 'transparent' && style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
//           const colorName = element.getAttribute('title') || 
//                            element.getAttribute('data-color') || 
//                            element.getAttribute('aria-label') ||
//                            element.textContent.trim();
                          
//           if (colorName && !variants.colors.includes(colorName)) {
//             variants.colors.push(colorName);
//           }
//         }
//       }
      
//       // Method 4: Parse product title for variants
//       const productTitle = document.querySelector('h1, h2.product-name, .product-title');
//       if (productTitle) {
//         const titleText = productTitle.textContent;
        
//         // Look for color in title
//         const colorMatch = titleText.match(/\(([^)]*(?:color|colour)[^)]*)\)/i) || 
//                           titleText.match(/,\s*([^,]*(?:color|colour)[^,]*)/i);
                          
//         if (colorMatch && colorMatch[1]) {
//           const colorText = colorMatch[1].replace(/color|colour/i, '').trim();
//           if (colorText && !variants.colors.includes(colorText)) {
//             variants.colors.push(colorText);
//           }
//         }
//       }
      
//       // Remove duplicates
//       variants.colors = [...new Set(variants.colors)];
//       variants.sizes = [...new Set(variants.sizes)];
//       variants.other = [...new Set(variants.other)];
      
//       return variants;
//     });
//   }
  
//   /**
//    * Update the extract basic data function to include variant extraction
//    * @param {object} page - Puppeteer page object
//    * @param {object} pageIndex - Inverted index of page elements
//    * @returns {Promise<object>} Basic product data including variants
//    */
//   async function extractBasicDataWithIndex(page, pageIndex) {
//     const data = {
//       title: null,
//       price: null,
//       originalPrice: null,
//       description: null,
//       features: [],
//       images: [],
//       variants: {
//         sizes: [],
//         colors: [],
//         other: []
//       },
//       delivery: {
//         available: null,
//         estimatedDate: null,
//         charges: null
//       },
//       weight: null,
//       category: null
//     };
    
//     try {
//       // [existing code for extracting other basic data]
      
//       // Extract variants using our new platform-specific extractors
//       const platform = await page.evaluate(() => {
//         const url = window.location.href;
//         if (url.includes('amazon')) return 'amazon';
//         if (url.includes('flipkart')) return 'flipkart';
//         if (url.includes('myntra')) return 'myntra';
//         if (url.includes('snapdeal')) return 'snapdeal';
//         return 'generic';
//       });
      
//       const variantData = await extractProductVariants(page, platform);
//       if (variantData) {
//         data.variants = variantData;
//       }
      
//       return data;
//     } catch (error) {
//       console.error('Error extracting with inverted index:', error);
//       return data;
//     }
//   }
  
//   /**
//    * Update the extractDataWithAI function to specifically request variant information
//    * Modify the prompt to emphasize variants extraction:
//    */
//   const updatedPrompt = `
//     Extract complete product information from this ${platform} product page. 
//     Identify the following information without missing any details:
//     1. Product title (full title)
//     2. Current price (with currency)
//     3. Original price if available (with currency)
//     4. Complete product description
//     5. All features/specifications
//     6. All available variants (colors, sizes, etc.) - PAY SPECIAL ATTENTION TO VARIANT OPTIONS
//     7. All product images URLs (make sure to get full-sized images, not thumbnails)
//     8. Delivery information
//     9. Weight information (if available) - this is especially important, search thoroughly for weight
//     10. Product category
    
//     Return the data as a valid JSON object with these fields:
//     {
//       "title": "string",
//       "price": "string",
//       "originalPrice": "string or null",
//       "description": "string",
//       "features": ["array of strings"],
//       "variants": {
//         "sizes": ["array of available sizes"],
//         "colors": ["array of available colors"],
//         "other": ["any other variant types"]
//       },
//       "images": ["array of image URLs"],
//       "delivery": {
//         "available": "boolean",
//         "estimatedDate": "string or null",
//         "pincode": "string or null"
//       },
//       "weight": "string or null",
//       "category": "string"
//     }
    
//     IMPORTANT: Make sure to extract ALL available variant options (colors, sizes) on the page. Look for selectable options, dropdowns, and color swatches. This is critical!
    
//     IMPORTANT: DO NOT include comments or explanations in your JSON. Make sure your JSON is valid and properly formatted.
//     If any information is missing, include the field with a null value.
//   `;
  
//   // Include this code in your scrapeProduct function to ensure variants are extracted:
//   async function improvedScraperWithVariants(url, options = {}) {
//     // [existing code]
    
//     // After extracting basic data but before finalizing product data
//     // Add this specific variants extraction step
//     const platform = detectPlatform(url);
//     const variantData = await extractProductVariants(page, platform);
    
//     // If variants were found through direct extraction, merge them with the product data
//     if (variantData && (variantData.colors.length > 0 || variantData.sizes.length > 0 || variantData.other.length > 0)) {
//       productData.variants = variantData;
//     }
    
//     // If still no variants, try a specific AI request just for variants
//     if (!productData.variants.colors.length && !productData.variants.sizes.length) {
//       try {
//         console.log("Attempting specific variants extraction with AI");
//         const variantsPrompt = `
//           Look at this product page from ${platform} and extract ONLY the available variants:
//           1. All available colors/colour options
//           2. All available sizes
//           3. Any other variant types (style, model, etc.)
          
//           Return ONLY a JSON object with these fields:
//           {
//             "colors": ["array of color options"],
//             "sizes": ["array of size options"],
//             "other": ["array of other variant options"]
//           }
//         `;
        
//         const screenshotBuffer = await page.screenshot({ fullPage: false });
//         const screenshotBase64 = screenshotBuffer.toString('base64');
        
//         const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
//         const result = await geminiModel.generateContent({
//           contents: [
//             { role: "user", parts: [
//               { text: variantsPrompt },
//               { inlineData: { mimeType: "image/jpeg", data: screenshotBase64 } }
//             ]}
//           ]
//         });
        
//         const responseText = result.response.text();
//         const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
//                          responseText.match(/{[\s\S]*}/);
        
//         if (jsonMatch) {
//           try {
//             let jsonText = jsonMatch[1] || jsonMatch[0];
//             jsonText = jsonText
//               .replace(/\s*\/\/.*?\n/g, '') // Remove single-line comments
//                 .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
//                 .replace(/,\s*}/g, '}') // Remove trailing commas in objects
//                 .replace(/,\s*]/g, ']') // Remove trailing commas in arrays
//                 .replace(/[\r\n\t]/g, ' ') // Replace newlines and tabs with spaces
//                 .replace(/\s+/g, ' '); // Normalize whitespace
              
//               const aiVariants = JSON.parse(jsonText);
              
//               // Update the product data with these variants
//               productData.variants = {
//                 colors: [...(productData.variants.colors || []), ...(aiVariants.colors || [])],
//                 sizes: [...(productData.variants.sizes || []), ...(aiVariants.sizes || [])],
//                 other: [...(productData.variants.other || []), ...(aiVariants.other || [])]
//               };
              
//               // Remove duplicates
//               productData.variants.colors = [...new Set(productData.variants.colors)];
//               productData.variants.sizes = [...new Set(productData.variants.sizes)];
//               productData.variants.other = [...new Set(productData.variants.other)];
//             } catch (jsonError) {
//               console.error('Error parsing variants JSON:', jsonError);
//             }
//           }
//         } catch (variantAiError) {
//           console.error('AI variants extraction failed:', variantAiError);
//         }
//       }
      
//       // [continue with the rest of the scraper function]
//     }
    
//     // Additional method for Flipkart specific variant extraction
//     async function extractFlipkartVariantsSpecifically(page) {
//       // This function specifically targets Flipkart's unique DOM structure
//       try {
//         const hasVariants = await page.evaluate(() => {
//           // Check for variant section containers on Flipkart
//           const variantContainers = document.querySelectorAll('div._3Oikkn, div._22QfJJ, div._1kg0D\\_');
//           return variantContainers && variantContainers.length > 0;
//         });
        
//         if (!hasVariants) {
//           return null;
//         }
        
//         // Execute a specialized extraction for Flipkart variants
//         return await page.evaluate(() => {
//           const variants = {
//             sizes: [],
//             colors: [],
//             other: []
//           };
          
//           // Recent Flipkart color selector patterns
//           try {
//             // Method for color buttons/swatches
//             const colorButtons = document.querySelectorAll('div[data-testid="color-variant-item"], div._1q8vht4 > div, div._3Oikkn > div, div._2C41yO > div');
//             if (colorButtons && colorButtons.length > 0) {
//               for (const button of colorButtons) {
//                 // Check for color indicator (often has non-transparent background)
//                 const style = window.getComputedStyle(button);
//                 const hasBackgroundColor = style.backgroundColor !== 'transparent' && 
//                                           style.backgroundColor !== 'rgba(0, 0, 0, 0)';
                
//                 // Look for color name in various attributes
//                 let colorName = null;
//                 if (button.hasAttribute('title')) {
//                   colorName = button.getAttribute('title');
//                 } else if (button.hasAttribute('aria-label')) {
//                   colorName = button.getAttribute('aria-label');
//                 } else if (button.children.length === 0) {
//                   colorName = button.textContent.trim();
//                 }
                
//                 // If no name but has background, use that as an indicator
//                 if (!colorName && hasBackgroundColor) {
//                   // Find a parent or adjacent element that might have the color name
//                   const nearbyText = Array.from(button.parentElement.children)
//                     .filter(el => el !== button && el.textContent.trim().length > 0)
//                     .map(el => el.textContent.trim());
                    
//                   if (nearbyText.length > 0) {
//                     colorName = nearbyText[0];
//                   } else {
//                     // Use CSS color as fallback
//                     colorName = style.backgroundColor;
//                   }
//                 }
                
//                 // Add unique colors to the list
//                 if (colorName && !variants.colors.includes(colorName)) {
//                   variants.colors.push(colorName);
//                 }
//               }
//             }
            
//             // Check for presence of a variant selection grid with a label
//             const variantSections = Array.from(document.querySelectorAll('div, p, span'))
//               .filter(el => {
//                 const text = el.textContent.toLowerCase().trim();
//                 return (text === 'colour' || text === 'color' || text === 'size' || text === 'variant') && 
//                        el.nextElementSibling;
//               });
            
//             for (const section of variantSections) {
//               const sectionType = section.textContent.toLowerCase().trim();
//               const optionsContainer = section.nextElementSibling || section.parentElement;
              
//               if (!optionsContainer) continue;
              
//               // Look for option elements in the options container
//               const optionElements = optionsContainer.querySelectorAll('div, button, a, li');
//               const options = Array.from(optionElements)
//                 .map(el => el.textContent.trim())
//                 .filter(text => text && text.length > 0 && text.length < 20); // Options are usually short
              
//               if (options.length > 0) {
//                 if (sectionType === 'colour' || sectionType === 'color') {
//                   variants.colors = [...variants.colors, ...options];
//                 } else if (sectionType === 'size') {
//                   variants.sizes = [...variants.sizes, ...options];
//                 } else {
//                   variants.other = [...variants.other, ...options];
//                 }
//               }
//             }
            
//             // Check for specific Flipkart selector patterns
//             const sizeSelectors = [
//               '.size-buttons-size-container button',
//               'div._2C41yO button',
//               'div._1q8vht4 button',
//               'div._3Oikkn button'
//             ];
            
//             for (const selector of sizeSelectors) {
//               const sizeButtons = document.querySelectorAll(selector);
//               if (sizeButtons && sizeButtons.length > 0) {
//                 for (const button of sizeButtons) {
//                   const sizeText = button.textContent.trim();
//                   if (sizeText && sizeText.length < 10 && !variants.sizes.includes(sizeText)) {
//                     variants.sizes.push(sizeText);
//                   }
//                 }
//               }
//             }
//           } catch (e) {
//             // Ignore errors in specific pattern matching
//           }
          
//           // Look for dropdown menus
//           try {
//             const dropdowns = document.querySelectorAll('select');
//             for (const dropdown of dropdowns) {
//               const options = Array.from(dropdown.querySelectorAll('option'))
//                 .map(option => option.textContent.trim())
//                 .filter(text => text && text !== 'Select' && text.length > 0);
                
//               if (options.length > 0) {
//                 // Try to determine what type of dropdown this is
//                 const label = dropdown.getAttribute('aria-label') || 
//                              dropdown.getAttribute('title') || 
//                              dropdown.previousElementSibling?.textContent || '';
                             
//                 if (label.toLowerCase().includes('color') || label.toLowerCase().includes('colour')) {
//                   variants.colors = [...variants.colors, ...options];
//                 } else if (label.toLowerCase().includes('size')) {
//                   variants.sizes = [...variants.sizes, ...options];
//                 } else {
//                   variants.other = [...variants.other, ...options];
//                 }
//               }
//             }
//           } catch (e) {
//             // Ignore dropdown errors
//           }
          
//           // Check product schema for more variant info (Flipkart sometimes has this)
//           try {
//             const schemaScripts = document.querySelectorAll('script[type="application/ld+json"]');
//             for (const script of schemaScripts) {
//               try {
//                 const schema = JSON.parse(script.textContent);
                
//                 // Check for product schema
//                 if (schema['@type'] === 'Product') {
//                   // Look for variants in offers
//                   if (schema.offers && Array.isArray(schema.offers)) {
//                     for (const offer of schema.offers) {
//                       if (offer.name && typeof offer.name === 'string') {
//                         // Extract variant info from offer name
//                         const nameParts = offer.name.split(',');
//                         for (const part of nameParts) {
//                           if (part.toLowerCase().includes('color') || part.toLowerCase().includes('colour')) {
//                             const colorValue = part.split(':')[1]?.trim();
//                             if (colorValue && !variants.colors.includes(colorValue)) {
//                               variants.colors.push(colorValue);
//                             }
//                           } else if (part.toLowerCase().includes('size')) {
//                             const sizeValue = part.split(':')[1]?.trim();
//                             if (sizeValue && !variants.sizes.includes(sizeValue)) {
//                               variants.sizes.push(sizeValue);
//                             }
//                           }
//                         }
//                       }
//                     }
//                   }
//                 }
//               } catch (schemaError) {
//                 // Ignore schema parsing errors
//               }
//             }
//           } catch (e) {
//             // Ignore schema extraction errors
//           }
          
//           // Extract colors from product title as a backup
//           try {
//             const productTitle = document.querySelector('h1, .B_NuCI');
//             if (productTitle) {
//               const titleText = productTitle.textContent.toLowerCase();
              
//               // Look for color mentioned in title
//               const colorPatterns = [
//                 /\(([^)]*(?:color|colour)[^)]*)\)/i,
//                 /color:?\s*([^,]+)/i,
//                 /colour:?\s*([^,]+)/i
//               ];
              
//               for (const pattern of colorPatterns) {
//                 const match = titleText.match(pattern);
//                 if (match && match[1]) {
//                   const colorText = match[1].trim();
//                   if (colorText && !variants.colors.includes(colorText)) {
//                     variants.colors.push(colorText);
//                   }
//                 }
//               }
//             }
//           } catch (e) {
//             // Ignore title extraction errors
//           }
          
//           // Remove duplicates and clean up
//           variants.colors = [...new Set(variants.colors)].filter(c => c.length > 0);
//           variants.sizes = [...new Set(variants.sizes)].filter(s => s.length > 0);
//           variants.other = [...new Set(variants.other)].filter(o => o.length > 0);
          
//           return variants;
//         });
//       } catch (error) {
//         console.error('Error in specialized Flipkart variant extraction:', error);
//         return null;
//       }
//     }
    
//     // Additional function to directly extract variant information from the DOM
//     // This is particularly useful for Flipkart
//     async function extractVariantsFromDOM(page) {
//       try {
//         return await page.evaluate(() => {
//           const variants = {
//             colors: [],
//             sizes: [],
//             other: []
//           };
          
//           // Method 1: Look for typical variant containers
//           // Common element formats used to display variants on e-commerce sites
          
//           // 1a. Look for variant sections with labels
//           const variantSectionLabels = Array.from(document.querySelectorAll('div, span, h3, h4, p, label'))
//             .filter(el => {
//               const text = el.textContent.trim().toLowerCase();
//               return (text === 'color' || text === 'colour' || text === 'size' || 
//                       text === 'variation' || text === 'select' || text === 'options') &&
//                      el.tagName.toLowerCase() !== 'option' && // Exclude dropdown options
//                      text.length < 50; // Should be a short label
//             });
          
//           // For each label, find associated options
//           for (const label of variantSectionLabels) {
//             const labelText = label.textContent.trim().toLowerCase();
            
//             // Different sites structure options differently - could be siblings, children, or inside a child container
            
//             // Check parent container for options
//             const parent = label.parentElement;
//             if (!parent) continue;
            
//             // Look for common types of variant selectors
//             const optionSelectors = [
//               'button',         // Button-based selectors
//               'li',             // List item options
//               'div[role="button"]', // Div styled as buttons
//               'a.option',       // Link options
//               'span.option',    // Span options
//               'div.option'      // Div options
//             ];
            
//             let options = [];
            
//             // Try looking in siblings or adjacent elements
//             const sibling = label.nextElementSibling;
//             if (sibling) {
//               // Look in direct sibling
//               for (const selector of optionSelectors) {
//                 const elements = sibling.querySelectorAll(selector);
//                 if (elements && elements.length > 0) {
//                   const texts = Array.from(elements)
//                     .map(el => el.textContent.trim())
//                     .filter(text => text && text.length > 0 && text.length < 30); // Options are usually short
//                   options = [...options, ...texts];
//                 }
//               }
              
//               // If still no options, look for text content directly
//               if (options.length === 0 && sibling.textContent.trim().length < 100) {
//                 options.push(sibling.textContent.trim());
//               }
//             }
            
//             // Also look in parent for options
//             for (const selector of optionSelectors) {
//               const elements = parent.querySelectorAll(selector);
//               if (elements && elements.length > 0) {
//                 const texts = Array.from(elements)
//                   .filter(el => el !== label) // Exclude the label itself
//                   .map(el => el.textContent.trim())
//                   .filter(text => text && text.length > 0 && text.length < 30);
//                 options = [...options, ...texts];
//               }
//             }
            
//             // Assign to appropriate variant type
//             if (labelText.includes('color') || labelText.includes('colour')) {
//               variants.colors = [...variants.colors, ...options];
//             } else if (labelText.includes('size')) {
//               variants.sizes = [...variants.sizes, ...options];
//             } else {
//               variants.other = [...variants.other, ...options];
//             }
//           }
          
//           // Method 2: Look for color swatch elements (squares or circles with background colors)
//           const potentialColorSwatches = Array.from(document.querySelectorAll('div, span, button, li'))
//             .filter(el => {
//               // Small element with non-transparent background color
//               const style = window.getComputedStyle(el);
//               const rect = el.getBoundingClientRect();
              
//               // Check if it has a non-transparent background color
//               const hasColor = style.backgroundColor !== 'transparent' && 
//                               style.backgroundColor !== 'rgba(0, 0, 0, 0)';
              
//               // Check if it's small (likely a color swatch)
//               const isSmall = (rect.width < 50 && rect.height < 50) || 
//                              (rect.width === rect.height && rect.width < 60);
              
//               // Check if it's inside a color-like container
//               const parentText = el.parentElement?.textContent.toLowerCase() || '';
//               const inColorContainer = parentText.includes('color') || 
//                                       parentText.includes('colour') ||
//                                       el.parentElement?.className.toLowerCase().includes('color') ||
//                                       el.parentElement?.id.toLowerCase().includes('color');
              
//               return hasColor && (isSmall || inColorContainer);
//             });
          
//           // Extract color names from these swatches
//           for (const swatch of potentialColorSwatches) {
//             let colorName = swatch.getAttribute('title') || 
//                           swatch.getAttribute('aria-label') || 
//                           swatch.getAttribute('data-color') ||
//                           swatch.textContent.trim();
            
//             // If no name but has color attribute, use that
//             if (!colorName || colorName === '') {
//               colorName = swatch.getAttribute('data-value') || 
//                          swatch.style.backgroundColor || 
//                          window.getComputedStyle(swatch).backgroundColor;
//             }
            
//             // If there's still no color name, look for nearby text elements
//             if (!colorName || colorName === '') {
//               const parent = swatch.parentElement;
//               if (parent) {
//                 const siblings = Array.from(parent.children)
//                   .filter(el => el !== swatch && el.textContent.trim().length > 0 && el.textContent.trim().length < 20);
                
//                 if (siblings.length > 0) {
//                   colorName = siblings[0].textContent.trim();
//                 }
//               }
//             }
            
//             if (colorName && !variants.colors.includes(colorName)) {
//               variants.colors.push(colorName);
//             }
//           }
          
//           // Method 3: Look for size option buttons/elements
//           const sizePatterns = [
//             /^(xs|s|m|l|xl|xxl|xxxl)$/i,  // Common clothing sizes
//             /^(\d+\s*(?:mm|cm|in(?:ch)?|ft))$/i, // Dimensional sizes
//             /^\d+(?:\.\d+)?\s*(?:"|'|cm|mm|inch(?:es)?)$/i, // Measurements
//             /^(?:one size|standard|regular|plus|petite)$/i, // Special size names
//             /^\d+\s*(?:gb|tb|mb|kb|ml|oz|mg|kg)$/i // Memory/weight sizes
//           ];
          
//           const potentialSizeElements = Array.from(document.querySelectorAll('button, span, div, li'))
//             .filter(el => {
//               const text = el.textContent.trim();
//               if (!text || text.length > 10) return false; // Size texts are usually short
              
//               // Check if it matches common size patterns
//               return sizePatterns.some(pattern => pattern.test(text)) ||
//                      // Or if it's in a size container
//                      (el.parentElement?.textContent.toLowerCase().includes('size') ||
//                       el.parentElement?.className.toLowerCase().includes('size') ||
//                       el.parentElement?.id.toLowerCase().includes('size'));
//             });
          
//           for (const element of potentialSizeElements) {
//             const sizeText = element.textContent.trim();
//             if (sizeText && !variants.sizes.includes(sizeText)) {
//               variants.sizes.push(sizeText);
//             }
//           }
          
//           // Method 4: Check for dropdowns
//           const dropdowns = document.querySelectorAll('select');
//           for (const dropdown of dropdowns) {
//             const options = Array.from(dropdown.querySelectorAll('option'))
//               .map(option => option.textContent.trim())
//               .filter(text => text && text !== 'Select' && text.length > 0);
              
//             if (options.length > 0) {
//               // Try to determine what type of dropdown this is
//               const label = dropdown.getAttribute('aria-label') || 
//                            dropdown.getAttribute('name') || 
//                            dropdown.getAttribute('id') || 
//                            dropdown.previousElementSibling?.textContent || '';
                           
//               if (label.toLowerCase().includes('color') || label.toLowerCase().includes('colour')) {
//                 variants.colors = [...variants.colors, ...options];
//               } else if (label.toLowerCase().includes('size')) {
//                 variants.sizes = [...variants.sizes, ...options];
//               } else {
//                 variants.other = [...variants.other, ...options];
//               }
//             }
//           }
          
//           // Remove duplicates
//           variants.colors = [...new Set(variants.colors)].filter(c => c && c.length > 0);
//           variants.sizes = [...new Set(variants.sizes)].filter(s => s && s.length > 0);
//           variants.other = [...new Set(variants.other)].filter(o => o && o.length > 0);
          
//           return variants;
//         });
//       } catch (error) {
//         console.error('Error extracting variants from DOM:', error);
//         return {
//           colors: [],
//           sizes: [],
//           other: []
//         };
//       }
//     }
    
//     // Helper function to integrate all variant extraction methods
//     async function getAllVariants(page, platform) {
//       // Start with platform-specific extraction
//       const platformVariants = await extractProductVariants(page, platform);
      
//       // Try Flipkart-specific extraction for Flipkart
//       let flipkartVariants = null;
//       if (platform === 'flipkart') {
//         flipkartVariants = await extractFlipkartVariantsSpecifically(page);
//       }
      
//       // Try general DOM extraction
//       const domVariants = await extractVariantsFromDOM(page);
      
//       // Combine all results
//       const combinedVariants = {
//         colors: [
//           ...(platformVariants?.colors || []),
//           ...(flipkartVariants?.colors || []),
//           ...(domVariants?.colors || [])
//         ],
//         sizes: [
//           ...(platformVariants?.sizes || []),
//           ...(flipkartVariants?.sizes || []),
//           ...(domVariants?.sizes || [])
//         ],
//         other: [
//           ...(platformVariants?.other || []),
//           ...(flipkartVariants?.other || []),
//           ...(domVariants?.other || [])
//         ]
//       };
      
//       // Remove duplicates
//       return {
//         colors: [...new Set(combinedVariants.colors)].filter(c => c && c.length > 0),
//         sizes: [...new Set(combinedVariants.sizes)].filter(s => s && s.length > 0),
//         other: [...new Set(combinedVariants.other)].filter(o => o && o.length > 0)
//       };
//     }
    
//     // Update the main scrapeProduct function to use all variant extraction methods
//     async function scrapeProduct(url, options = {}) {
//       // [existing code]
      
//       // Before returning the product data
//       try {
//         // Extract variants using all available methods
//         const platform = detectPlatform(url);
//         const allVariants = await getAllVariants(page, platform);
        
//         // Update product data with the combined variants
//         productData.variants = allVariants;
        
//         // If still no variants after all these methods, try one last approach with AI
//         if (allVariants.colors.length === 0 && allVariants.sizes.length === 0) {
//           console.log("No variants found, trying AI extraction as last resort");
          
//           // AI extraction code for variants
//           // [existing AI extraction code as shown in the previous section]
//         }
//       } catch (variantError) {
//         console.error("Error during variant extraction:", variantError);
//         // Continue with whatever variants we have (if any)
//       }
      
//       // Continue with the rest of the function
//       // [existing code]
//     }
    
//     // IMPORTANT: Make sure to include these new functions in your module.exports
//     module.exports = {
//       scrapeProduct,
//       ScraperError,
//       extractProductVariants,
//       extractFlipkartVariants,
//       extractAmazonVariants,
//       extractMyntraVariants,
//       extractSnapdealVariants,
//       extractGenericVariants,
//       extractFlipkartVariantsSpecifically,
//       extractVariantsFromDOM,
//       getAllVariants
//     };