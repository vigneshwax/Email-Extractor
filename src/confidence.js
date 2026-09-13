const FREE_MAIL_PROVIDERS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'aol.com', 'proton.me', 'protonmail.com', 'zoho.com', 'mail.com', 'gmx.com'
]);

/**
 * Calculates a transparent 0-100 confidence score with an auditable factor breakdown
 */
function calculateConfidenceScore(email, details) {
  const [local, domain] = email.split('@');
  const targetRoot = details.companyRootDomain;
  const verifiedList = details.verifiedDomainList || [targetRoot];
  
  let score = 0;
  const positiveFactors = [];
  const negativeFactors = [];

  // 1. Matches company verified domain (+35)
  const isVerifiedDomain = verifiedList.some(v => domain === v || domain.endsWith('.' + v));
  if (isVerifiedDomain) {
    score += 35;
    positiveFactors.push({ factor: 'Domain matches verified corporate domain', points: +35 });
  } else {
    score -= 35;
    negativeFactors.push({ factor: `Domain "@${domain}" does not match any verified corporate domain`, points: -35 });
  }

  // 2. Found on official Contact or About page (+30)
  if (details.sources.has('contact_page') || details.discoveryMethods.has('Contact Page')) {
    score += 30;
    positiveFactors.push({ factor: 'Published directly on official Contact page', points: +30 });
  }

  // 3. Found in direct Mailto link (+20)
  if (details.sources.has('mailto') || details.sources.has('mailto_link')) {
    score += 20;
    positiveFactors.push({ factor: 'Linked as active mailto anchor for immediate communication', points: +20 });
  }

  // 4. Structured Data (schema.org Organization/Person) (+15)
  if (details.sources.has('structured_data')) {
    score += 15;
    positiveFactors.push({ factor: 'Registered in official JSON-LD schema metadata', points: +15 });
  }

  // 5. Header / Footer placement (+15)
  if (details.sources.has('footer') || details.sources.has('header')) {
    score += 15;
    positiveFactors.push({ factor: 'Featured in global site header/footer navigational structure', points: +15 });
  }

  // 6. Associated with named professional person (+15)
  if (details.hasPersonAssociation) {
    score += 15;
    positiveFactors.push({ factor: `Directly associated with verified person/role (${details.personName})`, points: +15 });
  }

  // 7. Found in official Document / PDF (+15)
  if (details.sources.has('pdf_document') || details.discoveryMethods.has('PDF Document')) {
    score += 15;
    positiveFactors.push({ factor: 'Documented in published corporate PDF or file', points: +15 });
  }

  // 8. Search Engine OSINT corroboration (+10)
  if (details.sources.has('search_engine') || details.discoveryMethods.has('Search Engine')) {
    score += 10;
    positiveFactors.push({ factor: 'Corroborated by independent search index queries', points: +10 });
  }

  // 9. Multi-page / Multiple source corroboration (+15)
  if (details.pageCount >= 2 || details.sources.size >= 2) {
    score += 15;
    positiveFactors.push({ factor: `Cross-verified across ${details.pageCount} pages and ${details.sources.size} independent sources`, points: +15 });
  }

  // 10. Active MX mail server confirmed (+10)
  if (details.hasMx) {
    score += 10;
    positiveFactors.push({ factor: `Active MX mail exchange verified (${details.emailProvider || 'Valid MX'})`, points: +10 });
  } else if (details.hasMx === false) {
    score -= 20;
    negativeFactors.push({ factor: 'Domain has no active MX records configured', points: -20 });
  }

  // Suspicious deductions
  if (FREE_MAIL_PROVIDERS.has(domain.toLowerCase())) {
    if (!details.sources.has('contact_page') && !details.sources.has('mailto')) {
      score -= 30;
      negativeFactors.push({ factor: 'Uses free webmail provider without contact page confirmation', points: -30 });
    } else {
      score -= 10;
      negativeFactors.push({ factor: 'Free webmail address (verified on official contact page)', points: -10 });
    }
  }

  if (/(example|test|sample|yourcompany|domain|yourname|mycompany)/i.test(domain) || /(test|sample|admin1|user|username|your-name)/i.test(local)) {
    score -= 40;
    negativeFactors.push({ factor: 'Matches template/placeholder test pattern', points: -40 });
  }

  // Role account distinction (informative, not penalized)
  const isRoleAccount = /^(info|contact|support|sales|hello|help|admin|press|marketing|jobs|careers|team|billing|office)$/i.test(local);

  // Clamp score between 0 and 100
  score = Math.max(0, Math.min(100, Math.round(score)));

  let confidenceBadge = 'Low Confidence';
  let badgeColor = 'gray';

  if (score >= 90) {
    confidenceBadge = 'Verified Official';
    badgeColor = 'green';
  } else if (score >= 75) {
    confidenceBadge = 'Highly Likely';
    badgeColor = 'teal';
  } else if (score >= 50) {
    confidenceBadge = 'Possible';
    badgeColor = 'amber';
  } else {
    confidenceBadge = 'Unverified';
    badgeColor = 'gray';
  }

  // Generate clear human-readable acceptance reason
  let acceptanceExplanation = '';
  if (isVerifiedDomain) {
    acceptanceExplanation = `Accepted: Confirmed on official corporate domain "${domain}". Cross-verified across ${details.sources.size} discovery source(s) with ${score}% confidence rating.`;
  } else {
    acceptanceExplanation = `Third-Party Included: Unverified external domain "${domain}", included per custom extraction settings.`;
  }

  return {
    score,
    confidenceBadge,
    badgeColor,
    isRoleAccount,
    positiveFactors,
    negativeFactors,
    acceptanceExplanation
  };
}

module.exports = {
  calculateConfidenceScore
};
