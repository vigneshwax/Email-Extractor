const cheerio = require('cheerio');

// Common false-positive words that might look like names but are generic UI labels
const GENERIC_TITLES = new Set([
  'contact', 'contact us', 'about us', 'team', 'our team', 'support', 'help',
  'email', 'phone', 'address', 'office', 'headquarters', 'department',
  'sales', 'marketing', 'press', 'careers', 'general', 'info', 'management',
  'privacy', 'terms', 'overview', 'details', 'executive'
]);

/**
 * Validates whether a candidate string looks like a legitimate human name
 */
function isValidPersonName(name) {
  if (!name || typeof name !== 'string') return false;
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 3 || clean.length > 50) return false;
  if (GENERIC_TITLES.has(clean.toLowerCase())) return false;
  // Should consist of 2-4 words, capitalized letters
  const words = clean.split(' ');
  if (words.length < 2 || words.length > 4) return false;
  // Must not contain numbers or suspicious symbols
  if (/[0-9@_#$%\^&*=+<>{}[\]\\]/.test(clean)) return false;
  // Each word should start with a capital letter or standard prefix (e.g. McDonald, de, von)
  const isNamePattern = /^[A-Z][a-zA-Z'.-]+(?:\s+(?:[A-Z][a-zA-Z'.-]+|de|van|von|al|bin))+$/;
  return isNamePattern.test(clean);
}

/**
 * Extracts public person & job title associations from HTML surrounding an email
 */
function extractPersonFromContext($, email, pageUrl, companyName) {
  const cleanEmail = email.toLowerCase().trim();
  let candidate = null;

  // 1. Inspect JSON-LD Structured Data for schema.org/Person or Employee
  $('script[type="application/ld+json"]').each((_, el) => {
    if (candidate) return;
    try {
      const data = JSON.parse($(el).text());
      const items = Array.isArray(data) ? data : [data];
      const flatten = items.flatMap(x => x?.['@graph'] || [x]).filter(Boolean);

      for (const obj of flatten) {
        const objEmail = String(obj.email || '').toLowerCase().trim();
        if (objEmail === cleanEmail) {
          const type = String(obj['@type'] || '');
          if (/Person|Employee/i.test(type) || obj.name) {
            const name = typeof obj.name === 'string' ? obj.name.trim() : null;
            const jobTitle = typeof obj.jobTitle === 'string' ? obj.jobTitle.trim() : null;
            if (name && isValidPersonName(name)) {
              candidate = {
                personName: name,
                jobTitle: jobTitle || null,
                company: companyName || null,
                sourceUrl: pageUrl,
                confidence: 95,
                evidence: 'Extracted from schema.org structured Person data'
              };
              return;
            }
          }
        }
      }
    } catch {}
  });

  if (candidate) return candidate;

  // 2. Look for mailto links or elements containing the email inside parent cards / team blocks
  const mailtoElements = $(`a[href*="${cleanEmail}"], *:contains("${cleanEmail}")`);
  
  mailtoElements.each((_, el) => {
    if (candidate) return;

    // Search closest card or container
    const container = $(el).closest('.team-member, .team-card, .leader, .bio, .card, .profile, .person, tr, article, li');
    if (!container || !container.length) return;

    // Search for person name inside container headings or strong tags
    const nameEl = container.find('h2, h3, h4, h5, strong, .name, .member-name, [class*="name"]').first();
    const rawName = nameEl.text().trim();

    if (isValidPersonName(rawName)) {
      // Find possible job title
      const titleEl = container.find('.title, .role, .designation, .job-title, [class*="title"], [class*="role"], p, span')
        .not(nameEl)
        .first();

      let jobTitle = titleEl.text().trim();
      if (jobTitle && (jobTitle.length > 60 || jobTitle.includes(cleanEmail) || jobTitle.length < 3)) {
        jobTitle = null;
      }

      candidate = {
        personName: rawName,
        jobTitle: jobTitle || null,
        company: companyName || null,
        sourceUrl: pageUrl,
        confidence: 85,
        evidence: `Discovered on contact/team card on ${pageUrl}`
      };
    }
  });

  return candidate;
}

module.exports = {
  extractPersonFromContext,
  isValidPersonName
};
