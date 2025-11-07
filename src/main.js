import { Actor } from 'apify';
import { PuppeteerCrawler } from 'crawlee';

await Actor.init();

const input = await Actor.getInput();
const {
    searchQuery,
    location = '',
    maxListings = 50,
    minPrice,
    maxPrice,
    condition = 'all',
    sortBy = 'best_match',
    proxy = { useApifyProxy: true, apifyProxyGroups: [] }
} = input;

console.log('🔍 Starting Facebook Marketplace scraper...');
console.log(`📦 Searching for: "${searchQuery}"`);
console.log(`📍 Location: ${location || 'Default location'}`);
console.log(`🎯 Max listings: ${maxListings}`);

// Build Facebook Marketplace search URL
const buildSearchUrl = () => {
    const baseUrl = 'https://www.facebook.com/marketplace';
    const params = new URLSearchParams();

    if (searchQuery) params.append('query', searchQuery);
    if (minPrice) params.append('minPrice', minPrice);
    if (maxPrice) params.append('maxPrice', maxPrice);
    if (sortBy && sortBy !== 'best_match') params.append('sortBy', sortBy);

    const queryString = params.toString();
    return queryString ? `${baseUrl}/search/?${queryString}` : `${baseUrl}/search`;
};

const startUrl = buildSearchUrl();
console.log(`🌐 Starting URL: ${startUrl}`);

let scrapedCount = 0;

const crawler = new PuppeteerCrawler({
    proxyConfiguration: proxy.useApifyProxy
        ? await Actor.createProxyConfiguration(proxy)
        : undefined,
    maxRequestsPerCrawl: 1,
    maxConcurrency: 1,
    launchContext: {
        launchOptions: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        }
    },
    preNavigationHooks: [
        async ({ page }) => {
            // Randomize viewport
            await page.setViewport({
                width: 1920,
                height: 1080
            });

            // Set user agent
            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );
        }
    ],
    async requestHandler({ page, request }) {
        console.log(`📄 Processing: ${request.url}`);

        try {
            // Wait for marketplace to load
            console.log('⏳ Waiting for marketplace feed...');
            await page.waitForTimeout(5000);

            // Scroll to load more listings
            console.log('📜 Scrolling to load listings...');
            await autoScroll(page);

            // Extract listings
            console.log('🔎 Extracting listings...');
            const listings = await page.evaluate(() => {
                const results = [];

                // Find all marketplace listing links
                const listingCards = document.querySelectorAll('a[href*="/marketplace/item/"]');

                listingCards.forEach((card) => {
                    try {
                        const url = card.href;

                        // Extract title
                        const titleEl = card.querySelector('span[dir="auto"]');
                        const title = titleEl ? titleEl.textContent.trim() : null;

                        // Extract price - look for text with $ symbol
                        const priceEl = card.querySelector('span');
                        let price = null;
                        if (priceEl) {
                            const priceText = Array.from(card.querySelectorAll('span'))
                                .map(el => el.textContent)
                                .find(text => text.includes('$'));
                            price = priceText ? priceText.trim() : null;
                        }

                        // Extract location
                        const locationEl = Array.from(card.querySelectorAll('span'))
                            .find(el => {
                                const text = el.textContent.toLowerCase();
                                return text.includes('miles') || text.includes('km') || text.includes(',');
                            });
                        const location = locationEl ? locationEl.textContent.trim() : null;

                        // Extract image
                        const imgEl = card.querySelector('img');
                        const imageUrl = imgEl ? imgEl.src : null;

                        if (title && url) {
                            results.push({
                                title,
                                price,
                                location,
                                url,
                                imageUrl
                            });
                        }
                    } catch (err) {
                        console.log('Error extracting listing:', err.message);
                    }
                });

                return results;
            });

            console.log(`✅ Found ${listings.length} listings`);

            // Save listings to dataset
            for (const listing of listings.slice(0, maxListings)) {
                if (scrapedCount >= maxListings) break;

                await Actor.pushData({
                    ...listing,
                    searchQuery,
                    condition,
                    scrapedAt: new Date().toISOString()
                });

                scrapedCount++;
                console.log(`💾 Saved listing ${scrapedCount}/${maxListings}: ${listing.title}`);
            }

            console.log(`✅ Scraping complete! Extracted ${scrapedCount} listings.`);

        } catch (error) {
            console.error('❌ Error during scraping:', error.message);
            throw error;
        }
    },

    async failedRequestHandler({ request, error }) {
        console.log(`❌ Request failed: ${request.url}`);
        console.log(`❌ Error: ${error.message}`);
    }
});

// Helper function to auto-scroll the page
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 500;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight || totalHeight >= 5000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 200);
        });
    });
}

await crawler.run([startUrl]);

await Actor.exit();
