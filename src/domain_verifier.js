const { rootDomain } = require('./validator');

const JUNK_DOMAINS = new Set([
  'example.com', 'domain.com', 'yourcompany.com', 'email.com', 'sample.com', 'test.com',
  'sentry.io', 'sentry-cdn.com', 'wixpress.com', 'wix.com', 'squarespace.com', 'shopify.com',
  'wordpress.org', 'gravatar.com', 'schema.org', 'w3.org', 'google.com', 'googleapis.com',
  'gstatic.com', 'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com', 'youtube.com',
  'bootstrap.com', 'fontawesome.com', 'cloudflare.com', 'intercom.io', 'hubspot.com',
  'zendesk.com', 'polyfill.io', 'github.com', 'typekit.net', 'unpkg.com', 'jsdelivr.net',
  'sentry.com', 'bugsnag.com', 'datadoghq.com', 'segment.com', 'doubleclick.net', 'googletagmanager.com'
]);

function isCleanDomain(domain) {
  if (!domain || typeof domain !== 'string') return false;
  const clean = domain.toLowerCase().trim();
  if (JUNK_DOMAINS.has(clean)) return false;
  const parts = clean.split('.');
  if (parts.length < 2) return false;
  const tld = parts[parts.length - 1];
  if (tld.length < 2 || /\d/.test(tld)) return false;
  return true;
}

/**
 * Classifies domain relationship relative to the primary root domain
 */
function classifyDomainRelationship(candidateRoot, primaryRoot, officialName, evidenceSet) {
  if (candidateRoot === primaryRoot) {
    return 'Primary Official Domain';
  }

  const primaryBase = primaryRoot.split('.')[0];
  const candidateBase = candidateRoot.split('.')[0];
  const nameNorm = (officialName || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // 1. Regional Domain (same base brand name, different country TLD e.g. .co.uk, .in, .de)
  if (primaryBase === candidateBase) {
    return 'Regional Domain';
  }

  // 2. Secondary Official Domain (e.g. siddhanintelligence.com vs siddhan.ai or exact legal entity name)
  if (nameNorm && (candidateBase.includes(nameNorm) || nameNorm.includes(candidateBase) || candidateBase.includes(primaryBase))) {
    return 'Secondary Official Domain';
  }

  // 3. Check evidence clues
  const evidenceText = Array.from(evidenceSet).join(' ').toLowerCase();
  if (evidenceText.includes('subsidiary') || evidenceText.includes('division')) {
    return 'Subsidiary Domain';
  }
  if (evidenceText.includes('brand') || evidenceText.includes('product')) {
    return 'Brand Domain';
  }
  if (evidenceText.includes('partner') || evidenceText.includes('vendor')) {
    return 'Partner Domain';
  }

  return 'Secondary Official Domain';
}

/**
 * Comprehensive Corporate Identity and Multi-Domain Discovery Engine
 */
function discoverCompanyIdentityAndDomains(targetUrl, crawledResults, searchResults, documentResults) {
  const primaryHost = targetUrl.hostname;
  const primaryRoot = rootDomain(primaryHost);
  const nowIso = new Date().toISOString();

  // Extract base corporate candidate
  let officialCompanyName = primaryHost.replace(/^www\./, '').split('.')[0];
  if (officialCompanyName) {
    officialCompanyName = officialCompanyName.charAt(0).toUpperCase() + officialCompanyName.slice(1);
  }

  const alternateNames = new Set();
  const verifiedDomainsMap = new Map();

  // 1. Initialize Primary Target Domain
  verifiedDomainsMap.set(primaryRoot, {
    domain: primaryRoot,
    type: 'Primary Official Domain',
    status: 'Verified',
    evidence: new Set(['Primary target website host address']),
    firstDiscovered: nowIso,
    lastVerified: nowIso
  });

  // 2. Analyze Crawled Pages (Footer, Copyright, Privacy, Terms, Contact, JSON-LD, Titles)
  for (const page of crawledResults) {
    // Check page company name & title
    if (page.companyName && page.companyName.length > 2) {
      const cleanName = page.companyName.trim();
      alternateNames.add(cleanName);
      if (!officialCompanyName || officialCompanyName.toLowerCase() === primaryHost.split('.')[0].toLowerCase()) {
        officialCompanyName = cleanName;
      }
    }

    // Inspect canonical and redirect URLs
    if (page.finalUrl) {
      try {
        const finalHost = new URL(page.finalUrl).hostname;
        const finalRoot = rootDomain(finalHost);
        if (finalRoot && finalRoot !== primaryRoot && isCleanDomain(finalRoot)) {
          if (!verifiedDomainsMap.has(finalRoot)) {
            verifiedDomainsMap.set(finalRoot, {
              domain: finalRoot,
              type: 'Primary Official Domain (Canonical Redirect)',
              status: 'Verified',
              evidence: new Set([`HTTP redirect target: ${page.finalUrl}`]),
              firstDiscovered: nowIso,
              lastVerified: nowIso
            });
          }
        }
      } catch {}
    }

    // Inspect Copyright notices
    if (page.htmlSnippet || page.description) {
      const text = `${page.htmlSnippet || ''} ${page.description || ''}`;
      const copyrightMatch = text.match(/©\s*(?:\d{4}-)?\d{4}\s+([A-Za-z0-9\s.,&-]+)/i);
      if (copyrightMatch && copyrightMatch[1] && copyrightMatch[1].trim().length > 2) {
        const legalName = copyrightMatch[1].trim();
        alternateNames.add(legalName);
        if (!officialCompanyName || officialCompanyName.toLowerCase() === primaryHost.split('.')[0].toLowerCase()) {
          officialCompanyName = legalName;
        }
      }
    }

    // Inspect emails found in official locations (Contact, Mailto, Privacy, Footer)
    if (page.emailsMap) {
      page.emailsMap.forEach((sources, email) => {
        const emailDomain = email.split('@')[1];
        if (!emailDomain) return;
        const emailRoot = rootDomain(emailDomain);
        if (!isCleanDomain(emailRoot)) return;

        // If found on contact page, footer, or mailto link
        const isOfficialLocation = sources.has('contact_page') ||
                                   sources.has('footer') ||
                                   sources.has('mailto') ||
                                   sources.has('structured_data') ||
                                   page.isContactPage;

        if (isOfficialLocation) {
          if (!verifiedDomainsMap.has(emailRoot)) {
            verifiedDomainsMap.set(emailRoot, {
              domain: emailRoot,
              type: 'Secondary Official Domain',
              status: 'Verified',
              evidence: new Set(),
              firstDiscovered: nowIso,
              lastVerified: nowIso
            });
          }
          verifiedDomainsMap.get(emailRoot).evidence.add(`Listed in official contact email (${email}) on ${page.url}`);
        }
      });
    }
  }

  // 3. Analyze Search Engine OSINT Results
  if (searchResults && searchResults.searchDiscoveredEmails) {
    searchResults.searchDiscoveredEmails.forEach((sources, email) => {
      const emailDomain = email.split('@')[1];
      if (!emailDomain) return;
      const emailRoot = rootDomain(emailDomain);
      if (isCleanDomain(emailRoot)) {
        const primaryBase = primaryRoot.split('.')[0];
        const emailBase = emailRoot.split('.')[0];
        const nameBase = (officialCompanyName || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        // If domain base overlaps with company name or primary root
        if (emailBase.includes(primaryBase) || primaryBase.includes(emailBase) || (nameBase && emailBase.includes(nameBase))) {
          if (!verifiedDomainsMap.has(emailRoot)) {
            verifiedDomainsMap.set(emailRoot, {
              domain: emailRoot,
              type: 'Secondary Official Domain',
              status: 'Verified',
              evidence: new Set(['Corroborated by search engine corporate query']),
              firstDiscovered: nowIso,
              lastVerified: nowIso
            });
          } else {
            verifiedDomainsMap.get(emailRoot).evidence.add('Corroborated by search engine corporate query');
          }
        }
      }
    });
  }

  // 4. Analyze Public Documents Results
  if (documentResults && documentResults.documentDiscoveredEmails) {
    documentResults.documentDiscoveredEmails.forEach((sources, email) => {
      const emailDomain = email.split('@')[1];
      if (!emailDomain) return;
      const emailRoot = rootDomain(emailDomain);
      if (isCleanDomain(emailRoot)) {
        const primaryBase = primaryRoot.split('.')[0];
        const emailBase = emailRoot.split('.')[0];
        if (emailBase.includes(primaryBase) || primaryBase.includes(emailBase)) {
          if (!verifiedDomainsMap.has(emailRoot)) {
            verifiedDomainsMap.set(emailRoot, {
              domain: emailRoot,
              type: 'Public Document Domain',
              status: 'Verified',
              evidence: new Set(['Documented in official corporate publication']),
              firstDiscovered: nowIso,
              lastVerified: nowIso
            });
          } else {
            verifiedDomainsMap.get(emailRoot).evidence.add('Documented in official corporate publication');
          }
        }
      }
    });
  }

  // Finalize domain classification & evidence formatting
  const verifiedDomains = Array.from(verifiedDomainsMap.values()).map(item => {
    const classifiedType = classifyDomainRelationship(item.domain, primaryRoot, officialCompanyName, item.evidence);
    return {
      domain: item.domain,
      type: classifiedType,
      status: item.status,
      evidence: Array.from(item.evidence).join('; '),
      firstDiscovered: item.firstDiscovered,
      lastVerified: item.lastVerified
    };
  });

  const verifiedDomainList = verifiedDomains.map(d => d.domain);

  return {
    officialCompanyName,
    alternateNames: Array.from(alternateNames).filter(n => n !== officialCompanyName),
    verifiedDomains,
    verifiedDomainList
  };
}

module.exports = {
  discoverCompanyIdentityAndDomains,
  isCleanDomain
};
