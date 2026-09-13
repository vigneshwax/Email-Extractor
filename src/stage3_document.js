const axios = require('axios');
const crypto = require('node:crypto');
const { extractEmailsFromText, extractPhonesFromText, isValidEmail } = require('./extractor');
const { isLikelyScannedDocument, performOcr } = require('./ocr_engine');
const { validatePublicUrl } = require('./validator');

async function parsePdfBuffer(buffer) {
  try {
    const pdfModule = require('pdf-parse');
    if (typeof pdfModule === 'function') {
      const res = await pdfModule(buffer);
      return res.text || '';
    } else if (pdfModule && pdfModule.PDFParse) {
      const parser = new pdfModule.PDFParse(buffer);
      if (typeof parser.load === 'function') await parser.load();
      if (typeof parser.getText === 'function') {
        const textResult = await parser.getText();
        if (typeof parser.destroy === 'function') await parser.destroy().catch(() => {});
        return typeof textResult === 'string' ? textResult : (textResult?.text || '');
      }
    }
  } catch {
    // Fallback to stream regex extraction
    try {
      const str = buffer.toString('binary');
      const matches = str.match(/\(([^()]{3,})\)Tj/g) || [];
      return matches.map(m => m.slice(1, -3)).join(' ');
    } catch {}
  }
  return '';
}

async function downloadAndExtractDocument(rawUrl) {
  try {
    const validUrl = await validatePublicUrl(rawUrl).catch(() => null);
    if (!validUrl) return null;

    const response = await axios.get(validUrl.href, {
      timeout: 8000,
      responseType: 'arraybuffer',
      maxContentLength: 10 * 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MailScope/3.0 Document Intelligence Engine'
      }
    });

    const buffer = Buffer.from(response.data);
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const fileSize = buffer.length;
    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    let text = '';
    let isScanned = false;

    // Detect format
    if (/\.pdf$/i.test(validUrl.pathname) || contentType.includes('pdf')) {
      text = await parsePdfBuffer(buffer);

      if (isLikelyScannedDocument(text, fileSize)) {
        isScanned = true;
        // Run OCR if enabled
        const ocrText = await performOcr(buffer);
        if (ocrText && ocrText.length > text.length) {
          text = `${text}\n${ocrText}`;
        }
      }
    } else {
      // Text, XML, JSON, or CSV
      text = buffer.toString('utf-8');
    }

    const emails = extractEmailsFromText(text);
    const phones = extractPhonesFromText(text);

    // Extract basic title if discernible from top text
    const firstLines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const docTitle = firstLines[0] ? firstLines[0].slice(0, 100) : validUrl.pathname.split('/').pop();

    return {
      url: validUrl.href,
      filename: validUrl.pathname.split('/').pop() || 'document',
      docTitle,
      fileSize,
      sha256Hash,
      isScanned,
      emailsFound: emails,
      phonesFound: phones
    };
  } catch {
    return null;
  }
}

async function runStage3DocumentDiscovery(documentUrls) {
  const documentDiscoveredEmails = new Map();
  const documentPhones = new Set();
  const processedDocs = [];
  const seenHashes = new Set();

  const uniqueUrls = [...new Set(documentUrls)].slice(0, 6); // Cap at 6 documents to maintain speed

  for (const docUrl of uniqueUrls) {
    const docResult = await downloadAndExtractDocument(docUrl);
    if (!docResult) continue;

    // Deduplicate by content hash
    if (seenHashes.has(docResult.sha256Hash)) continue;
    seenHashes.add(docResult.sha256Hash);

    processedDocs.push(docResult);

    docResult.emailsFound.forEach(email => {
      if (isValidEmail(email)) {
        if (!documentDiscoveredEmails.has(email)) {
          documentDiscoveredEmails.set(email, new Set());
        }
        documentDiscoveredEmails.get(email).add('pdf_document');
      }
    });

    docResult.phonesFound.forEach(p => documentPhones.add(p));
  }

  return {
    documentDiscoveredEmails,
    documentPhones: Array.from(documentPhones),
    processedDocs
  };
}

module.exports = {
  downloadAndExtractDocument,
  runStage3DocumentDiscovery
};
