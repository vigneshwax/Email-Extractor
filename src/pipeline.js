const { validatePublicUrl, rootDomain } = require('./validator');
const { runStage1WebsiteDiscovery } = require('./stage1_website');
const { runStage2SearchEngineDiscovery } = require('./stage2_search');
const { runStage3DocumentDiscovery } = require('./stage3_document');
const { discoverCompanyIdentityAndDomains } = require('./domain_verifier');
const { classifyDepartment } = require('./classifier');
const { calculateConfidenceScore } = require('./confidence');
const { analyzeDnsInfrastructure } = require('./dns_intelligence');
const { extractPersonFromContext } = require('./person_extractor');
const { buildEvidenceGraph } = require('./evidence_graph');
const { defaultCache } = require('./cache_manager');

async function runEmailExtractionPipeline(inputUrl, options = {}) {
  const targetUrl = await validatePublicUrl(String(inputUrl || '').trim());
  const includeThirdParty = Boolean(options.includeThirdParty);
  const scanMode = options.scanMode || 'STANDARD'; // FAST | STANDARD | DEEP
  const primaryRoot = rootDomain(targetUrl.hostname);
  const origin = targetUrl.origin;

  // Check cache for recent results if not forced
  const cacheKey = `pipeline:${targetUrl.hostname}:${scanMode}:${includeThirdParty}`;
  if (!options.bypassCache) {
    const cached = defaultCache.get(cacheKey);
    if (cached) return cached;
  }

  // 1. Parallel Stage 1 (Website Crawling), Stage 2 (Search Engine OSINT), and DNS Intelligence
  const [stage1Result, stage2Result, dnsIntel] = await Promise.all([
    runStage1WebsiteDiscovery(targetUrl.href, { scanMode }),
    runStage2SearchEngineDiscovery(targetUrl.hostname, primaryRoot),
    analyzeDnsInfrastructure(targetUrl.hostname)
  ]);

  // 2. Stage 3 (Document Discovery & Intelligence)
  const allDocLinks = [...new Set([...stage1Result.documentLinks, ...stage2Result.documentLinks])];
  const stage3Result = await runStage3DocumentDiscovery(allDocLinks);

  // 3. DISCOVER OFFICIAL COMPANY NAME & ALL VERIFIED DOMAINS (BEFORE FILTERING)
  const {
    officialCompanyName,
    alternateNames,
    verifiedDomains,
    verifiedDomainList
  } = discoverCompanyIdentityAndDomains(
    targetUrl,
    stage1Result.crawledResults,
    stage2Result,
    stage3Result
  );

  // 4. AGGREGATE ALL DISCOVERED CANDIDATE EMAILS WITH CONTEXT
  const aggregatedEmails = new Map();

  function recordEmail(email, sourceTag, pageUrl, discoveryMethod, contextSnippet = '', cheerioRef = null) {
    const clean = email.toLowerCase().trim();
    if (!aggregatedEmails.has(clean)) {
      aggregatedEmails.set(clean, {
        sources: new Set(),
        pages: new Set(),
        discoveryMethods: new Set(),
        contexts: [],
        cheerioRefs: []
      });
    }
    const record = aggregatedEmails.get(clean);
    if (sourceTag) record.sources.add(sourceTag);
    if (pageUrl) record.pages.add(pageUrl);
    if (discoveryMethod) record.discoveryMethods.add(discoveryMethod);
    if (contextSnippet) record.contexts.push(contextSnippet);
    if (cheerioRef) record.cheerioRefs.push({ $: cheerioRef, pageUrl });
  }

  // Aggregate Stage 1 Results
  let companyDescription = '';
  const aggregatedPhones = new Set();

  for (const page of stage1Result.crawledResults) {
    if (page.description && !companyDescription) {
      companyDescription = page.description;
    }

    page.phones.forEach(p => aggregatedPhones.add(p));

    const pagePath = new URL(page.url).pathname;
    const isContact = page.isContactPage || /(contact|reach|get-in-touch)/i.test(pagePath);
    const isHomepage = pagePath === '/' || pagePath === '';

    let method = 'Website Discovery';
    if (isContact) method = 'Contact Page';
    else if (isHomepage) method = 'Homepage';

    page.emailsMap.forEach((sources, email) => {
      sources.forEach(s => recordEmail(email, s, page.url, method, page.htmlSnippet, page.$cheerio));
      if (isContact) {
        recordEmail(email, 'contact_page', page.url, 'Contact Page', page.htmlSnippet, page.$cheerio);
      }
      if (isHomepage) {
        recordEmail(email, 'homepage', page.url, 'Homepage', page.htmlSnippet, page.$cheerio);
      }
    });
  }

  // Aggregate Stage 2 Results
  stage2Result.searchDiscoveredEmails.forEach((sources, email) => {
    recordEmail(email, 'search_engine', `${origin}/?search_engine_discovery`, 'Search Engine');
  });

  // Aggregate Stage 3 Results (PDFs / Documents)
  stage3Result.documentDiscoveredEmails.forEach((sources, email) => {
    recordEmail(email, 'pdf_document', `${origin}/document.pdf`, 'PDF Document');
  });
  stage3Result.documentPhones.forEach(p => aggregatedPhones.add(p));

  // 5. FILTER & ACCEPT EMAILS BELONGING TO VERIFIED COMPANY DOMAINS
  const acceptedEmails = [];

  aggregatedEmails.forEach((record, email) => {
    const emailDomain = email.split('@')[1];
    const emailRoot = rootDomain(emailDomain);

    // Match against verified company domains
    const matchedDomainObj = verifiedDomains.find(v => emailDomain === v.domain || emailDomain.endsWith('.' + v.domain) || emailRoot === v.domain);
    const isOfficial = Boolean(matchedDomainObj);

    if (!isOfficial && !includeThirdParty) {
      // Reject emails belonging to unrelated third-party domains
      return;
    }

    const verifiedCompanyDomain = matchedDomainObj ? matchedDomainObj.domain : emailRoot;

    // Person & Job Role Extraction (inspecting surrounding HTML context)
    let personInfo = null;
    for (const ref of record.cheerioRefs) {
      if (ref.$) {
        personInfo = extractPersonFromContext(ref.$, email, ref.pageUrl, officialCompanyName);
        if (personInfo) break;
      }
    }

    const contextText = record.contexts.join(' ');
    const { department, isExplicit: deptExplicit } = classifyDepartment(email, contextText);

    const scoring = calculateConfidenceScore(email, {
      companyRootDomain: primaryRoot,
      verifiedDomainList,
      sources: record.sources,
      pageCount: record.pages.size,
      occurrenceCount: record.sources.size,
      discoveryMethods: record.discoveryMethods,
      hasPersonAssociation: Boolean(personInfo),
      personName: personInfo?.personName,
      hasMx: dnsIntel.hasMx,
      emailProvider: dnsIntel.emailProvider
    });

    // Determine primary discovery method
    let primaryMethod = 'Website Discovery';
    if (record.discoveryMethods.has('Contact Page')) primaryMethod = 'Contact Page';
    else if (record.sources.has('mailto')) primaryMethod = 'Mailto Anchor';
    else if (record.discoveryMethods.has('PDF Document')) primaryMethod = 'PDF Document';
    else if (record.discoveryMethods.has('Search Engine')) primaryMethod = 'Search Engine';
    else if (record.discoveryMethods.has('Homepage')) primaryMethod = 'Homepage';

    const sourceUrl = Array.from(record.pages)[0] || origin;

    let acceptanceReason = '';
    if (isOfficial) {
      const typeDesc = matchedDomainObj ? matchedDomainObj.type : 'Verified Corporate Domain';
      acceptanceReason = `Accepted: Domain "@${emailDomain}" matches verified corporate domain "${verifiedCompanyDomain}" (${typeDesc}). ${scoring.acceptanceExplanation}`;
    } else {
      acceptanceReason = `Third-Party Included: Domain "@${emailDomain}" is unverified, but included per search options.`;
    }

    acceptedEmails.push({
      email,
      sourceUrl,
      sourcePage: sourceUrl,
      discoveryMethod: primaryMethod,
      verifiedCompanyDomain,
      official: isOfficial,
      confidenceScore: scoring.score,
      confidenceBadge: scoring.confidenceBadge,
      badgeColor: scoring.badgeColor,
      acceptanceReason,
      department,
      deptExplicit,
      isRoleAccount: scoring.isRoleAccount,
      personName: personInfo ? personInfo.personName : null,
      jobTitle: personInfo ? personInfo.jobTitle : null,
      positiveFactors: scoring.positiveFactors,
      negativeFactors: scoring.negativeFactors,
      sources: Array.from(record.sources),
      pagesScannedCount: record.pages.size
    });
  });

  // Sort accepted emails by confidence score
  acceptedEmails.sort((a, b) => b.confidenceScore - a.confidenceScore || Number(b.official) - Number(a.official));

  const logoUrl = `https://www.google.com/s2/favicons?domain=${targetUrl.hostname}&sz=128`;

  // 6. Construct Auditable Evidence Graph
  const evidenceGraph = buildEvidenceGraph(
    officialCompanyName,
    verifiedDomains,
    stage1Result.crawledResults,
    stage3Result.processedDocs,
    acceptedEmails
  );

  const pipelineOutput = {
    company: officialCompanyName,
    alternateNames,
    verifiedDomains,
    verifiedDomainList,
    logoUrl,
    website: targetUrl.origin,
    rootDomain: primaryRoot,
    description: companyDescription,
    dnsIntelligence: dnsIntel,
    pagesCrawled: stage1Result.pagesCrawledCount,
    totalEmailsFound: aggregatedEmails.size,
    officialEmailsFound: acceptedEmails.filter(e => e.official).length,
    phones: Array.from(aggregatedPhones).slice(0, 8),
    documents: stage3Result.processedDocs,
    evidenceGraph,
    emails: acceptedEmails,
    scanMode,
    generatedAt: new Date().toISOString()
  };

  // Cache result for 15 minutes
  defaultCache.set(cacheKey, pipelineOutput, 15 * 60 * 1000);

  return pipelineOutput;
}

module.exports = {
  runEmailExtractionPipeline
};
