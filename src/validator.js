const dns = require('node:dns').promises;
const net = require('node:net');

// Standard blocked ports for SSRF prevention
const BLOCKED_PORTS = new Set([
  20, 21, 22, 23, 25, 53, 69, 110, 119, 123, 135, 137, 138, 139, 143,
  161, 389, 445, 636, 1433, 1521, 2049, 2375, 2376, 3306, 3389, 5432,
  5900, 6379, 8000, 8080, 8443, 8888, 9000, 9200, 11211, 27017
]);

function isPrivateIp(ip) {
  if (!ip || typeof ip !== 'string') return true;

  // Handle IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 or ::ffff:192.168.1.1)
  if (ip.startsWith('::ffff:')) {
    const v4 = ip.replace(/^::ffff:/i, '');
    if (net.isIPv4(v4)) {
      return isPrivateIp(v4);
    }
  }

  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p.some(n => isNaN(n) || n < 0 || n > 255)) return true;

    // 0.0.0.0/8 (Current network)
    if (p[0] === 0) return true;
    // 10.0.0.0/8 (Private network)
    if (p[0] === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (p[0] === 127) return true;
    // 169.254.0.0/16 (Link-local)
    if (p[0] === 169 && p[1] === 254) return true;
    // 172.16.0.0/12 (Private network: 172.16.0.0 - 172.31.255.255)
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    // 192.168.0.0/16 (Private network)
    if (p[0] === 192 && p[1] === 168) return true;
    // 100.64.0.0/10 (Shared address space / Carrier-grade NAT)
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (p[0] === 192 && p[1] === 0 && p[2] === 2) return true;
    // 198.18.0.0/15 (Network benchmark tests)
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (p[0] === 198 && p[1] === 51 && p[2] === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (p[0] === 203 && p[1] === 0 && p[2] === 113) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (p[0] >= 224) return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    const clean = ip.toLowerCase();
    // Loopback & Unspecified
    if (clean === '::1' || clean === '::' || clean === '0:0:0:0:0:0:0:1') return true;
    // Unique local address (fc00::/7)
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true;
    // Link-local unicast (fe80::/10)
    if (clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb') || clean.startsWith('fe80:')) return true;
    // Multicast (ff00::/8)
    if (clean.startsWith('ff')) return true;
    // Discard prefix (100::/64)
    if (clean.startsWith('100::')) return true;

    return false;
  }

  return true;
}

async function validatePublicUrl(value) {
  if (!value || typeof value !== 'string') {
    throw Object.assign(new Error('Please enter a valid website URL.'), { status: 400 });
  }

  let url;
  try {
    const raw = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error('Please enter a valid website URL.'), { status: 400 });
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('Only public HTTP or HTTPS websites are supported.'), { status: 400 });
  }

  if (url.username || url.password) {
    throw Object.assign(new Error('URLs with embedded credentials are not allowed.'), { status: 400 });
  }

  // Port checks: allow default ports or 80/443
  if (url.port) {
    const portNum = parseInt(url.port, 10);
    if (BLOCKED_PORTS.has(portNum) || portNum <= 0 || portNum > 65535) {
      throw Object.assign(new Error(`Access to port ${portNum} is restricted for security reasons.`), { status: 400 });
    }
  }

  url.hash = '';
  const hostname = url.hostname.toLowerCase();

  // Prevent direct IP targeting of private ranges even without DNS lookup
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw Object.assign(new Error('Private or local network IP addresses are not allowed.'), { status: 400 });
    }
  }

  // Check for localhost or local keywords
  if (['localhost', 'local', 'intranet', 'internal'].includes(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw Object.assign(new Error('Localhost and internal networks are restricted.'), { status: 400 });
  }

  // Resolve DNS records
  const records = await dns.lookup(hostname, { all: true }).catch(() => []);
  if (!records.length) {
    throw Object.assign(new Error('The website domain could not be found or resolved.'), { code: 'ENOTFOUND', status: 404 });
  }

  if (records.some(r => isPrivateIp(r.address))) {
    throw Object.assign(new Error('Private or local network addresses are not allowed.'), { status: 400 });
  }

  return url;
}

/**
 * Validates a redirect location against SSRF rules before navigating
 */
async function validateRedirectTarget(originalUrl, redirectLocation) {
  try {
    const resolvedUrl = new URL(redirectLocation, originalUrl);
    return await validatePublicUrl(resolvedUrl.href);
  } catch (err) {
    throw Object.assign(new Error(`Unsafe redirect target: ${err.message}`), { status: 400 });
  }
}

function rootDomain(hostname) {
  if (!hostname || typeof hostname !== 'string') return '';
  const parts = hostname.toLowerCase().replace(/^www\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  
  // Handle double-barrel TLDs (e.g. .co.uk, .com.au, .gov.uk, .org.in)
  const secondLast = parts[parts.length - 2];
  if (['com', 'co', 'org', 'net', 'gov', 'edu', 'ac', 'mil'].includes(secondLast) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

module.exports = {
  validatePublicUrl,
  validateRedirectTarget,
  rootDomain,
  isPrivateIp
};
