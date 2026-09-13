const dns = require('node:dns').promises;
const { defaultCache } = require('./cache_manager');

const KNOWN_MX_PROVIDERS = [
  { pattern: /google|googlemail|aspmx|l\.google\.com/i, name: 'Google Workspace / Gmail' },
  { pattern: /outlook|microsoft|hotmail|protection\.outlook/i, name: 'Microsoft 365 / Exchange' },
  { pattern: /protonmail|proton\.ch/i, name: 'Proton Mail' },
  { pattern: /zoho/i, name: 'Zoho Mail' },
  { pattern: /mimecast/i, name: 'Mimecast' },
  { pattern: /pphosted|proofpoint/i, name: 'Proofpoint' },
  { pattern: /barracuda/i, name: 'Barracuda' },
  { pattern: /fastmail/i, name: 'Fastmail' },
  { pattern: /amazonses|awstrack/i, name: 'Amazon SES' },
  { pattern: /sendgrid/i, name: 'SendGrid' },
  { pattern: /mailgun/i, name: 'Mailgun' },
  { pattern: /icloud|apple/i, name: 'Apple iCloud Mail' }
];

const KNOWN_NAMESERVERS = [
  { pattern: /cloudflare/i, name: 'Cloudflare' },
  { pattern: /awsdns|route53/i, name: 'Amazon Route 53' },
  { pattern: /googledomains|google/i, name: 'Google Cloud DNS' },
  { pattern: /godaddy|domaincontrol/i, name: 'GoDaddy' },
  { pattern: /namecheap/i, name: 'Namecheap' },
  { pattern: /azure-dns|microsoft/i, name: 'Microsoft Azure DNS' },
  { pattern: /digitalocean/i, name: 'DigitalOcean' }
];

async function analyzeDnsInfrastructure(domain) {
  if (!domain || typeof domain !== 'string') {
    return { error: 'Invalid domain' };
  }

  const cleanDomain = domain.toLowerCase().trim();
  const cacheKey = `dns:${cleanDomain}`;
  const cached = defaultCache.get(cacheKey);
  if (cached) return cached;

  const result = {
    domain: cleanDomain,
    hasMx: false,
    mxRecords: [],
    emailProvider: 'Unknown / Self-hosted',
    spf: {
      hasSpf: false,
      record: null,
      raw: null
    },
    dmarc: {
      hasDmarc: false,
      policy: null,
      record: null
    },
    nameservers: [],
    nsProvider: 'Unknown',
    aRecords: [],
    aaaaRecords: [],
    txtRecordsCount: 0,
    hasCaa: false,
    cdnIndicators: [],
    analyzedAt: new Date().toISOString()
  };

  // 1. Query MX records
  try {
    const mx = await dns.resolveMx(cleanDomain).catch(() => []);
    if (mx && mx.length > 0) {
      result.hasMx = true;
      result.mxRecords = mx.sort((a, b) => a.priority - b.priority).map(r => ({
        exchange: r.exchange,
        priority: r.priority
      }));

      for (const prov of KNOWN_MX_PROVIDERS) {
        if (result.mxRecords.some(r => prov.pattern.test(r.exchange))) {
          result.emailProvider = prov.name;
          break;
        }
      }
    }
  } catch {}

  // 2. Query TXT records (for SPF & verification)
  try {
    const txtRecords = await dns.resolveTxt(cleanDomain).catch(() => []);
    result.txtRecordsCount = txtRecords.length;

    for (const chunk of txtRecords) {
      const fullTxt = chunk.join('');
      if (/^v=spf1\b/i.test(fullTxt)) {
        result.spf.hasSpf = true;
        result.spf.record = fullTxt;
        result.spf.raw = fullTxt;
      }
    }
  } catch {}

  // 3. Query DMARC record (_dmarc.domain)
  try {
    const dmarcRecords = await dns.resolveTxt(`_dmarc.${cleanDomain}`).catch(() => []);
    for (const chunk of dmarcRecords) {
      const fullTxt = chunk.join('');
      if (/^v=DMARC1\b/i.test(fullTxt)) {
        result.dmarc.hasDmarc = true;
        result.dmarc.record = fullTxt;
        const policyMatch = fullTxt.match(/p=([a-z]+)/i);
        result.dmarc.policy = policyMatch ? policyMatch[1].toLowerCase() : 'none';
        break;
      }
    }
  } catch {}

  // 4. Query NS records
  try {
    const ns = await dns.resolveNs(cleanDomain).catch(() => []);
    result.nameservers = ns;
    for (const prov of KNOWN_NAMESERVERS) {
      if (ns.some(n => prov.pattern.test(n))) {
        result.nsProvider = prov.name;
        if (prov.name === 'Cloudflare') result.cdnIndicators.push('Cloudflare');
        break;
      }
    }
  } catch {}

  // 5. Query A and AAAA records
  try {
    const [a, aaaa] = await Promise.all([
      dns.resolve4(cleanDomain).catch(() => []),
      dns.resolve6(cleanDomain).catch(() => [])
    ]);
    result.aRecords = a;
    result.aaaaRecords = aaaa;
  } catch {}

  // 6. Query CAA records
  try {
    const caa = await dns.resolveCaa(cleanDomain).catch(() => []);
    if (caa && caa.length > 0) {
      result.hasCaa = true;
    }
  } catch {}

  result.mx = result.mxRecords;
  result.ns = result.nameservers;

  // Cache result for 1 hour
  defaultCache.set(cacheKey, result, 60 * 60 * 1000);
  return result;
}

module.exports = {
  analyzeDnsInfrastructure
};
