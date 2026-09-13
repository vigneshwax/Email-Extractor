let tesseract = null;
try {
  tesseract = require('tesseract.js');
} catch {
  tesseract = null;
}

/**
 * Checks if a PDF document is likely a scanned document lacking selectable text
 */
function isLikelyScannedDocument(text, fileSize) {
  const clean = (text || '').trim();
  // If file has substantial binary size (> 30KB) but less than 60 characters of text
  if (fileSize > 30000 && clean.length < 60) {
    return true;
  }
  return false;
}

/**
 * Performs OCR extraction on an image buffer or scanned document page
 */
async function performOcr(imageBuffer) {
  if (process.env.ENABLE_OCR === 'false') return '';
  if (!tesseract || !imageBuffer) return '';

  try {
    const { data: { text } } = await tesseract.recognize(imageBuffer, 'eng', {
      logger: () => {} // Silent logging
    });
    return text || '';
  } catch (err) {
    console.warn('OCR fallback skipped or error:', err.message);
    return '';
  }
}

module.exports = {
  isLikelyScannedDocument,
  performOcr
};
