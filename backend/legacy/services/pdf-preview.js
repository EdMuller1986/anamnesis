const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const PREVIEW_DIR = path.join(config.UPLOAD_DIR, 'previews');

/**
 * Convert PDF to PNG images using pdftoppm.
 * Returns array of generated PNG file paths.
 */
function convertPdfToImages(pdfPath) {
  if (!fs.existsSync(pdfPath)) return [];

  fs.mkdirSync(PREVIEW_DIR, { recursive: true });

  const basename = path.basename(pdfPath, '.pdf');
  const outputPrefix = path.join(PREVIEW_DIR, basename);

  try {
    execSync(`pdftoppm -png -r 200 "${pdfPath}" "${outputPrefix}"`, {
      timeout: 30000,
    });
  } catch (err) {
    console.error('pdftoppm error:', err.message);
    return [];
  }

  // pdftoppm creates files like prefix-1.png, prefix-2.png, etc.
  const files = fs.readdirSync(PREVIEW_DIR)
    .filter(f => f.startsWith(basename) && f.endsWith('.png'))
    .sort()
    .map(f => path.join(PREVIEW_DIR, f));

  return files;
}

/**
 * Get preview images for a document.
 * If previews already exist, return them. Otherwise generate.
 */
function getPreviewPaths(doc) {
  if (!doc.file_path || !doc.mime_type?.includes('pdf')) return [];

  const pdfPath = path.resolve(doc.file_path);
  const basename = path.basename(pdfPath, '.pdf');

  // Check if previews already exist
  if (fs.existsSync(PREVIEW_DIR)) {
    const existing = fs.readdirSync(PREVIEW_DIR)
      .filter(f => f.startsWith(basename) && f.endsWith('.png'))
      .sort();
    if (existing.length > 0) {
      return existing.map(f => path.join(PREVIEW_DIR, f));
    }
  }

  return convertPdfToImages(pdfPath);
}

/**
 * Get preview URLs (relative) for a document.
 */
function getPreviewUrls(doc) {
  const paths = getPreviewPaths(doc);
  return paths.map(p => `/uploads/previews/${path.basename(p)}`);
}

module.exports = { convertPdfToImages, getPreviewPaths, getPreviewUrls };
