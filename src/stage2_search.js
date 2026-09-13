const axios = require('axios');
const cheerio = require('cheerio');
const { extractEmailsFromText, isValidEmail } = require('./extractor');

async function performSearchQuery(query) {
  try {
    const params = new URLSearchParams({ q: query, b: '' });
    const response = await axios.post('https://html.duckduckgo.com/html/', params.toString(), {
      timeout: 3500,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 MailScope/3.0 OSINT Engine',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (response.status !== 200 || !response.data) return { text: '', links: [] };

    const $ = cheerio.load(String(response.data));
    const snippetsText = $('.result__snippet').text();
    const bodyText = $.text();

    const links = [];
    $('.result__url, a.result__url').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href) links.push(href);
    });

    return {
      text: `${snippetsText} ${bodyText}`,
      links
    };
  } catch {
    return { text: '', links: [] };
  }
}

async function runStage2SearchEngineDiscovery(domain, companyRoot) {
  const queries = [
    `site:${domain} "@${companyRoot}"`,
    `site:${domain} contact email`,
    `site:${domain} filetype:pdf "@${companyRoot}"`
  ];

  const searchDiscoveredEmails = new Map();
  const documentLinks = new Set();

  try {
    const results = await Promise.all(queries.map(q => performSearchQuery(q)));

    for (const res of results) {
      if (!res.text) continue;
      const emails = extractEmailsFromText(res.text);
      for (const email of emails) {
        if (isValidEmail(email)) {
          if (!searchDiscoveredEmails.has(email)) {
            searchDiscoveredEmails.set(email, new Set());
          }
          searchDiscoveredEmails.get(email).add('search_engine');
        }
      }

      for (const link of res.links) {
        if (/\.(pdf|doc|docx|xlsx|xls)$/i.test(link)) {
          documentLinks.add(link);
        }
      }
    }
  } catch {}

  return {
    searchDiscoveredEmails,
    documentLinks: Array.from(documentLinks)
  };
}

module.exports = {
  performSearchQuery,
  runStage2SearchEngineDiscovery
};
