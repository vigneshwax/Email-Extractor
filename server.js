const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { runEmailExtractionPipeline } = require('./src/pipeline');
const { analyzeDnsInfrastructure } = require('./src/dns_intelligence');
const { validatePublicUrl, rootDomain } = require('./src/validator');
const { discoverCompanyIdentityAndDomains } = require('./src/domain_verifier');
const { runStage1WebsiteDiscovery } = require('./src/stage1_website');
const { defaultCache } = require('./src/cache_manager');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(__dirname));

// Register Bulk Extractor routes
require('./bulk')(app);

// Health Check API
app.get('/api/health', (_, res) => {
  res.json({
    status: 'healthy',
    engine: 'MailScope Corporate Intelligence Engine v3.0',
    uptime: Math.round(process.uptime()),
    features: {
      playwrightFallback: process.env.ENABLE_PLAYWRIGHT !== 'false',
      ocrFallback: process.env.ENABLE_OCR !== 'false',
      dnsIntelligence: true,
      evidenceGraph: true,
      multiDomainVerification: true
    },
    timestamp: new Date().toISOString()
  });
});

// Primary Email & Corporate Contact Extraction Pipeline
app.post('/api/extract', async (req, res) => {
  try {
    const rawUrl = String(req.body.url || '').trim();
    const includeThirdParty = Boolean(req.body.includeThirdParty);
    const scanMode = String(req.body.scanMode || 'STANDARD').toUpperCase();
    const bypassCache = Boolean(req.body.bypassCache);

    if (!rawUrl) {
      return res.status(400).json({ error: 'Please enter a valid website URL.' });
    }

    const result = await runEmailExtractionPipeline(rawUrl, {
      includeThirdParty,
      scanMode,
      bypassCache
    });
    res.json(result);

  } catch (error) {
    let message = error.message || 'Unable to scan this website.';
    if (error.code === 'ECONNABORTED') message = 'The website took too long to respond.';
    else if (['ENOTFOUND', 'EAI_AGAIN'].includes(error.code)) message = 'The website domain could not be found.';
    else if (/certificate|ssl/i.test(message)) message = 'The website has an SSL certificate problem.';
    res.status(error.status || 502).json({ error: message });
  }
});

// Alias for Full Company Analysis
app.post('/api/company/analyze', async (req, res) => {
  try {
    const rawUrl = String(req.body.url || req.body.domain || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ error: 'Please provide a valid company website or domain.' });
    }
    const result = await runEmailExtractionPipeline(rawUrl, {
      includeThirdParty: Boolean(req.body.includeThirdParty),
      scanMode: req.body.scanMode || 'STANDARD'
    });
    res.json(result);
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message || 'Company analysis failed.' });
  }
});

// Dedicated Domain Verification Endpoint
app.post('/api/domain/verify', async (req, res) => {
  try {
    const rawInput = String(req.body.domain || req.body.url || '').trim();
    if (!rawInput) {
      return res.status(400).json({ error: 'Please provide a domain or URL to verify.' });
    }

    const targetUrl = await validatePublicUrl(rawInput);
    const crawlRes = await runStage1WebsiteDiscovery(targetUrl.href, { scanMode: 'FAST' });
    const identity = discoverCompanyIdentityAndDomains(targetUrl, crawlRes.crawledResults, null, null);

    res.json({
      primaryDomain: rootDomain(targetUrl.hostname),
      officialCompanyName: identity.officialCompanyName,
      verifiedDomains: identity.verifiedDomains,
      verifiedDomainList: identity.verifiedDomainList
    });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || 'Domain verification failed.' });
  }
});

// Dedicated DNS & Mail Infrastructure Analysis Endpoint
app.post('/api/dns/analyze', async (req, res) => {
  try {
    let hostname = String(req.body.domain || req.body.url || '').trim();
    if (!hostname) {
      return res.status(400).json({ error: 'Please provide a domain name to inspect.' });
    }
    hostname = hostname.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').split(':')[0].toLowerCase();

    // Verify it's a valid public hostname
    await validatePublicUrl(`https://${hostname}`);
    const dnsReport = await analyzeDnsInfrastructure(hostname);
    res.json(dnsReport);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || 'DNS analysis failed.' });
  }
});

// API 404 Handler - unknown API routes return JSON, not HTML
app.use('/api', (req, res) => {
  res.status(404).json({
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`
  });
});

// Static frontend catch-all for single-page client navigation
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MailScope Corporate Intelligence Engine v3.0 running on port ${PORT}`);
  });
}

module.exports = app;
