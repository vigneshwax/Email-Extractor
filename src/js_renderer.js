let playwright = null;
try {
  playwright = require('playwright');
} catch {
  playwright = null;
}

let browserInstance = null;
let browserPromise = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  if (browserPromise) return browserPromise;

  if (!playwright) return null;

  browserPromise = (async () => {
    try {
      browserInstance = await playwright.chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      });
      return browserInstance;
    } catch (err) {
      console.warn('Playwright chromium launch not available:', err.message);
      return null;
    } finally {
      browserPromise = null;
    }
  })();

  return browserPromise;
}

/**
 * Detects if static HTML appears to be an empty Single Page Application (SPA) shell
 * needing JavaScript rendering (e.g. React/Vue/Angular/Svelte placeholders with very little content)
 */
function needsJsRendering(html, textLength) {
  if (process.env.ENABLE_PLAYWRIGHT === 'false') return false;
  if (!html) return true;

  // If page text is very short (under 250 characters) and has client-side app mounting points
  if (textLength < 250) {
    if (/<div\s+id=["'](root|app|__next|__nuxt|svelte)["']/i.test(html) ||
        /<app-root\b/i.test(html) ||
        /window\.__INITIAL_STATE__/i.test(html) ||
        /<noscript>You need to enable JavaScript/i.test(html)) {
      return true;
    }
  }

  // Obvious client-side redirects or loaders
  if (/location\.replace|window\.location\s*=/i.test(html) && textLength < 150) {
    return true;
  }

  return false;
}

/**
 * Renders page using Playwright when static HTML lacks content
 */
async function renderWithPlaywright(url, timeoutMs = 12000) {
  if (process.env.ENABLE_PLAYWRIGHT === 'false') return null;

  const browser = await getBrowser();
  if (!browser) return null;

  let context = null;
  let page = null;
  try {
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 MailScope/2.0 OSINT Engine',
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true
    });

    page = await context.newPage();

    // Block heavy media to save bandwidth and speed up rendering
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,mp4,mp3,woff,woff2,ttf}', route => route.abort());

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });

    // Wait a brief tick for dynamic hydration/rendering
    await page.waitForTimeout(1000);

    const content = await page.content();
    const finalUrl = page.url();

    return {
      html: content,
      finalUrl
    };
  } catch (err) {
    // Graceful fallback - do not crash
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

module.exports = {
  needsJsRendering,
  renderWithPlaywright
};
