const axios = require('axios');
const cheerio = require('cheerio');
const { validatePublicUrl, validateRedirectTarget, rootDomain } = require('./validator');
const { parseHtmlContent } = require('./extractor');
const { needsJsRendering, renderWithPlaywright } = require('./js_renderer');

const REQUEST_TIMEOUT = 6000;
const CONCURRENCY = 6;

const FAST_PRIORITY_PATHS = [
  '/', '/contact', '/contact-us', '/about', '/about-us', '/privacy', '/terms'
];

const STANDARD_PRIORITY_PATHS = [
  '/', '/contact', '/contact-us', '/contacts', '/about', '/about-us',
  '/careers', '/jobs', '/team', '/our-team', '/leadership', '/support', '/help',
  '/privacy', '/privacy-policy', '/terms', '/terms-of-service', '/legal',
  '/investors', '/media', '/news', '/press', '/imprint', '/impressum'
];

const LINK_KEYWORDS_RE = /(contact|about|team|leader|staff|career|job|support|help|press|media|investor|privacy|terms|legal|imprint|impressum|location|office)/i;

/**
 * Safe HTTP fetch with SSRF re-validation on every redirect hop
 */
async function fetchUrlContent(targetUrl, timeout = REQUEST_TIMEOUT, redirects = 0) {
  try {
    const url = await validatePublicUrl(targetUrl);
    const response = await axios.get(url.toString(), {
      timeout,
      maxRedirects: 0, // Manual redirect following for strict SSRF validation
      responseType: 'text',
      maxContentLength: 5 * 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MailScope/3.0 OSINT Engine',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      validateStatus: s => s >= 200 && s < 400
    });

    // Handle redirects safely
    if (response.status >= 300 && response.headers.location) {
      if (redirects >= 4) return null; // Avoid redirect loops
      const nextTarget = await validateRedirectTarget(url.toString(), response.headers.location);
      return await fetchUrlContent(nextTarget.href, timeout, redirects + 1);
    }

    return {
      status: response.status,
      headers: response.headers,
      data: String(response.data),
      finalUrl: response.request?.res?.responseUrl || url.toString()
    };
  } catch {
    return null;
  }
}

async function discoverSitemaps(baseUrl, companyRoot, scanMode = 'STANDARD') {
  const origin = new URL(baseUrl).origin;
  const sitemapUrls = new Set([
    `${origin}/sitemap.xml`
  ]);

  if (scanMode !== 'FAST') {
    sitemapUrls.add(`${origin}/sitemap_index.xml`);
  }

  // 1. Fetch robots.txt with fast timeout
  const robotsRes = await fetchUrlContent(`${origin}/robots.txt`, 3500);
  if (robotsRes && robotsRes.data) {
    const lines = robotsRes.data.split('\n');
    for (const line of lines) {
      if (/^\s*Sitemap:\s*/i.test(line)) {
        const smUrl = line.replace(/^\s*Sitemap:\s*/i, '').trim();
        if (smUrl) sitemapUrls.add(smUrl);
      }
    }
  }

  const discoveredPages = new Set();
  const documentLinks = new Set();
  const visitedSitemaps = new Set();
  const maxSitemaps = scanMode === 'FAST' ? 1 : scanMode === 'DEEP' ? 8 : 3;

  async function parseSitemap(sitemapUrl) {
    if (visitedSitemaps.has(sitemapUrl) || visitedSitemaps.size >= maxSitemaps) return;
    visitedSitemaps.add(sitemapUrl);

    const res = await fetchUrlContent(sitemapUrl, 3500);
    if (!res || !res.data) return;

    const $ = cheerio.load(res.data, { xmlMode: true });

    // Handle nested sitemaps (<sitemap><loc>...</loc></sitemap>)
    if (scanMode !== 'FAST') {
      const nestedSitemaps = [];
      $('sitemap loc, sitemapindex loc').each((_, el) => {
        const loc = $(el).text().trim();
        if (loc) nestedSitemaps.push(loc);
      });

      for (const nested of nestedSitemaps.slice(0, 3)) {
        if (visitedSitemaps.size < maxSitemaps) {
          await parseSitemap(nested);
        }
      }
    }

    // Handle standard URLs (<url><loc>...</loc></url>)
    $('url loc, urlset loc').each((_, el) => {
      const loc = $(el).text().trim();
      if (!loc) return;
      try {
        const parsed = new URL(loc);
        if (rootDomain(parsed.hostname) === companyRoot) {
          if (/\.(pdf|doc|docx|xlsx|xls)$/i.test(parsed.pathname)) {
            documentLinks.add(parsed.href);
          } else if (LINK_KEYWORDS_RE.test(parsed.pathname)) {
            discoveredPages.add(parsed.href);
          }
        }
      } catch {}
    });
  }

  await Promise.all(Array.from(sitemapUrls).slice(0, 3).map(sm => parseSitemap(sm)));

  return {
    sitemapPages: Array.from(discoveredPages),
    documentLinks: Array.from(documentLinks)
  };
}

async function runStage1WebsiteDiscovery(targetUrl, options = {}) {
  const origin = new URL(targetUrl).origin;
  const companyRoot = rootDomain(new URL(targetUrl).hostname);
  const scanMode = options.scanMode || 'STANDARD';
  const maxPages = scanMode === 'FAST' ? 8 : scanMode === 'DEEP' ? 45 : 25;

  // 1. Discover sitemaps and robots.txt
  const { sitemapPages, documentLinks } = await discoverSitemaps(origin, companyRoot, scanMode);

  // Build priority queue
  const queueSet = new Set();
  const pathsList = scanMode === 'FAST' ? FAST_PRIORITY_PATHS : STANDARD_PRIORITY_PATHS;

  // Add standard priority paths
  pathsList.forEach(p => queueSet.add(new URL(p, origin).href));

  // Add sitemap discovered pages
  sitemapPages.slice(0, 15).forEach(p => queueSet.add(p));

  const queue = Array.from(queueSet);
  const seenUrls = new Set();

  const crawledResults = [];
  const discoveredDocLinks = new Set(documentLinks);

  // Helper for crawling single URL with Playwright fallback if needed
  async function crawlPage(url) {
    seenUrls.add(url);
    let html = '';
    let finalUrl = url;

    // 1. Static Axios + Cheerio first
    const res = await fetchUrlContent(url, REQUEST_TIMEOUT);
    if (res && res.data) {
      const contentType = String(res.headers['content-type'] || '');
      if (contentType.includes('text/html') || contentType.includes('application/xml')) {
        html = res.data;
        finalUrl = res.finalUrl;
      }
    }

    // 2. Check if content is empty SPA requiring Playwright fallback
    const textSample = cheerio.load(html).text().trim();
    if (needsJsRendering(html, textSample.length)) {
      const rendered = await renderWithPlaywright(url);
      if (rendered && rendered.html) {
        html = rendered.html;
        finalUrl = rendered.finalUrl || url;
      }
    }

    if (!html) return;

    const extracted = parseHtmlContent(html, url);

    // Check for document links (.pdf, .doc, .docx, .xlsx)
    extracted.$('a[href]').each((_, a) => {
      try {
        const href = extracted.$(a).attr('href');
        if (!href) return;
        const resolved = new URL(href, url);
        if (/\.(pdf|doc|docx|xlsx|xls)$/i.test(resolved.pathname)) {
          discoveredDocLinks.add(resolved.href);
        }
      } catch {}
    });

    // Extract internal links for queue expansion
    const newInternalLinks = [];
    extracted.$('a[href]').each((_, a) => {
      try {
        const href = extracted.$(a).attr('href');
        if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return;
        const resolved = new URL(href, url);
        resolved.hash = '';
        if (rootDomain(resolved.hostname) === companyRoot) {
          if (LINK_KEYWORDS_RE.test(resolved.pathname + extracted.$(a).text())) {
            newInternalLinks.push(resolved.href);
          }
        }
      } catch {}
    });

    crawledResults.push({
      url,
      finalUrl,
      emailsMap: extracted.emailsMap,
      phones: extracted.phones,
      companyName: extracted.companyName,
      description: extracted.description,
      htmlSnippet: extracted.htmlSnippet || '',
      isContactPage: /(contact|reach|get-in-touch)/i.test(url),
      newInternalLinks,
      $cheerio: extracted.$
    });
  }

  // Helper for batch crawling
  async function crawlBatch(urls) {
    const promises = urls.map(url => crawlPage(url));
    await Promise.all(promises);
  }

  while (queue.length > 0 && seenUrls.size < maxPages) {
    const batch = [];
    while (queue.length > 0 && batch.length < CONCURRENCY && (seenUrls.size + batch.length) < maxPages) {
      const nextUrl = queue.shift();
      if (!seenUrls.has(nextUrl)) {
        batch.push(nextUrl);
      }
    }

    if (!batch.length) break;

    await crawlBatch(batch);

    // Add newly discovered priority internal links to queue
    crawledResults.forEach(r => {
      r.newInternalLinks.forEach(link => {
        if (!seenUrls.has(link) && !queue.includes(link) && queue.length < 35) {
          queue.push(link);
        }
      });
    });
  }

  return {
    crawledResults,
    pagesCrawledCount: seenUrls.size,
    documentLinks: Array.from(discoveredDocLinks)
  };
}

module.exports = {
  fetchUrlContent,
  runStage1WebsiteDiscovery
};
