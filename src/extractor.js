const cheerio = require('cheerio');

const FILE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|tiff|bmp|ico|css|js|woff|woff2|ttf|eot|mp4|webm|pdf|zip|tar|gz|mp3|wav|ogg)$/i;

const JUNK_DOMAINS = new Set([
  'example.com', 'domain.com', 'yourcompany.com', 'email.com', 'sample.com', 'test.com',
  'sentry.io', 'sentry-cdn.com', 'wixpress.com', 'wix.com', 'squarespace.com', 'shopify.com',
  'wordpress.org', 'gravatar.com', 'schema.org', 'w3.org', 'google.com', 'googleapis.com',
  'gstatic.com', 'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com',
  'bootstrap.com', 'fontawesome.com', 'cloudflare.com', 'intercom.io', 'hubspot.com',
  'zendesk.com', 'polyfill.io', 'github.com', 'typekit.net', 'unpkg.com', 'jsdelivr.net',
  'sentry.com', 'bugsnag.com', 'datadoghq.com', 'segment.com', 'doubleclick.net'
]);

const PHONE_RE = /(?:\+?\d{1,3}[\s().-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/g;

function decodeObfuscatedHtml(html) {
  if (!html) return '';
  return html
    .replace(/&#64;|&commat;|%40/gi, '@')
    .replace(/&#46;|&period;|%2e/gi, '.')
    .replace(/([a-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\s+at\s+|\s*\[&#64;\]\s*)\s*([a-z0-9.-]+\.[a-z]{2,})/gi, '$1@$2')
    .replace(/([a-z0-9._%+-]+@[a-z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\s+dot\s+)\s*([a-z]{2,})/gi, '$1.$2');
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string' || email.length > 254) return false;
  
  const clean = email.toLowerCase().trim().replace(/[),.;:!?'"]+$/, '');
  
  // Exclude CSS rules or JS directives starting with @
  if (clean.startsWith('@') || /^(import|media|keyframes|font-face|page|charset|supports|layer)/i.test(clean)) {
    return false;
  }

  const parts = clean.split('@');
  if (parts.length !== 2) return false;

  const [local, domain] = parts;
  if (!local || !domain) return false;
  if (local.length > 64 || domain.length > 190) return false;

  // Filter out image assets like logo@2x.png or image@3x.jpg
  if (FILE_EXT_RE.test(clean) || FILE_EXT_RE.test(domain) || FILE_EXT_RE.test(local)) return false;

  // Filter out JS placeholder variables, escaped unicode, and fake sample patterns
  if (/(\$\{.*\}|\{.*\}|%s|u003c|u003e|undefined|null|your-email|your_email|name@|email@|user@|username@|first.last@|example@)/i.test(clean)) {
    return false;
  }

  // Filter out junk/vendor domains
  if (JUNK_DOMAINS.has(domain)) return false;

  // Must have valid TLD
  const domainParts = domain.split('.');
  if (domainParts.length < 2) return false;
  const tld = domainParts[domainParts.length - 1];
  if (tld.length < 2 || /\d/.test(tld)) return false;

  // Local part structure validation
  if (/^[^a-z0-9]|[^a-z0-9]$/i.test(local) && !/^[a-z0-9].*[a-z0-9]$/i.test(local)) return false;

  return true;
}

function extractEmailsFromText(text) {
  if (!text) return [];
  const matches = text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi) || [];
  return [...new Set(matches.map(m => m.toLowerCase().replace(/[),.;:!?'"]+$/, '')).filter(isValidEmail))];
}

function extractPhonesFromText(text) {
  if (!text) return [];
  const matches = text.match(PHONE_RE) || [];
  const phones = [];
  for (const raw of matches) {
    const cleaned = raw.trim().replace(/\s+/g, ' ');
    const digitsOnly = cleaned.replace(/\D/g, '');
    if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
      phones.push(cleaned);
    }
  }
  return [...new Set(phones)];
}

function parseHtmlContent(html, pageUrl) {
  const decodedHtml = decodeObfuscatedHtml(html);
  const $ = cheerio.load(decodedHtml);

  // Remove elements that cause noise
  $('style, noscript, svg').remove();

  const foundMap = new Map(); // email -> Set of sources

  const addEmail = (email, source) => {
    if (!isValidEmail(email)) return;
    const clean = email.toLowerCase().replace(/[),.;:!?'"]+$/, '');
    if (!foundMap.has(clean)) {
      foundMap.set(clean, new Set());
    }
    foundMap.get(clean).add(source);
  };

  // 1. Mailto links
  $('a[href^="mailto:"]').each((_, el) => {
    const rawHref = $(el).attr('href') || '';
    const candidate = rawHref.replace(/^mailto:/i, '').split('?')[0].trim();
    if (candidate) addEmail(candidate, 'mailto');
  });

  // 2. Structured Data (JSON-LD & Microdata)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const items = Array.isArray(data) ? data : [data];
      const flatten = items.flatMap(x => x?.['@graph'] || [x]).filter(Boolean);
      flatten.forEach(obj => {
        if (obj.email) {
          const ems = Array.isArray(obj.email) ? obj.email : [obj.email];
          ems.forEach(e => typeof e === 'string' && addEmail(e, 'structured_data'));
        }
        if (obj.contactPoint) {
          const points = Array.isArray(obj.contactPoint) ? obj.contactPoint : [obj.contactPoint];
          points.forEach(pt => pt.email && typeof pt.email === 'string' && addEmail(pt.email, 'structured_data'));
        }
      });
    } catch { /* ignore bad JSON-LD */ }
  });

  // 3. Header, Footer, Team cards, Contact cards
  $('header, footer, .footer, .header, .contact-card, .team-card, .card, [class*="contact"], [class*="team"]').each((_, el) => {
    const blockText = $(el).text();
    const emails = extractEmailsFromText(blockText);
    const sourceTag = $(el).is('header') ? 'header' : $(el).is('footer') ? 'footer' : 'contact_card';
    emails.forEach(e => addEmail(e, sourceTag));
  });

  // 4. Inline Scripts / Hydration
  $('script:not([src])').each((_, el) => {
    const scriptContent = $(el).html() || '';
    if (scriptContent.includes('email') || scriptContent.includes('@')) {
      const emails = extractEmailsFromText(scriptContent);
      emails.forEach(e => addEmail(e, 'inline_javascript'));
    }
  });

  // 5. Full Body Text
  const bodyText = $.text();
  const bodyEmails = extractEmailsFromText(bodyText);
  bodyEmails.forEach(e => addEmail(e, 'visible_text'));

  const phones = extractPhonesFromText(bodyText);

  // Extract Metadata & Company Info
  let companyName = $('meta[property="og:site_name"]').attr('content') ||
                    $('meta[name="application-name"]').attr('content') ||
                    $('title').text().split(/[|–—-]/)[0].trim();

  let description = $('meta[name="description"]').attr('content') ||
                    $('meta[property="og:description"]').attr('content') || '';

  return {
    emailsMap: foundMap,
    phones,
    companyName: companyName.slice(0, 100),
    description: description.slice(0, 300),
    $
  };
}

module.exports = {
  isValidEmail,
  extractEmailsFromText,
  extractPhonesFromText,
  parseHtmlContent,
  decodeObfuscatedHtml
};
