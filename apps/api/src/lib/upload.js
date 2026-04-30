/**
 * Configuration Multer pour l'upload de fichiers KYC 
 * Stockage sur disque local (ou S3 en production via STORAGE_TYPE=s3)
 *
 * Types de fichiers acceptés : PDF, JPEG, PNG, WEBP
 * Taille maximale : KYC_MAX_FILE_SIZE_MB (défaut : 10 Mo par fichier)
 * Nombre max de fichiers par upload : KYC_MAX_FILES (défaut : 5)
 */

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const MAX_FILE_SIZE_MB = parseInt(process.env.KYC_MAX_FILE_SIZE_MB) || 10;
const MAX_FILES = parseInt(process.env.KYC_MAX_FILES) || 5;
const UPLOAD_DIR = process.env.KYC_UPLOAD_DIR || path.join(__dirname, '../../uploads/kyc');

// S'assurer que le dossier existe
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];

/**
 * Stockage sur disque : renomme les fichiers avec un nom aléatoire pour éviter
 * les collisions et les attaques de traversée de répertoire.
 */
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Sous-dossier par merchant ID pour isoler les fichiers
    const merchantDir = path.join(UPLOAD_DIR, req.merchant?.id || 'unknown');
    fs.mkdirSync(merchantDir, { recursive: true });
    cb(null, merchantDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const randomName = crypto.randomBytes(16).toString('hex');
    cb(null, `${Date.now()}-${randomName}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype) || !ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error(`Type de fichier non autorisé: ${file.mimetype}. Types acceptés: PDF, JPEG, PNG, WEBP`));
  }
  cb(null, true);
}

const kycUpload = multer({
  storage: diskStorage,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: MAX_FILES,
  },
  fileFilter,
});

/**
 * Retourne les métadonnées sûres d'un fichier uploadé (sans le chemin absolu).
 */
function toFileMetadata(file) {
  return {
    originalName: file.originalname,
    storedName: file.filename,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    uploadedAt: new Date().toISOString(),
    // Chemin relatif depuis UPLOAD_DIR (pour reconstitution future)
    relativePath: path.relative(UPLOAD_DIR, file.path),
  };
}

/**
 * Retourne l'URL publique (ou le chemin) d'un fichier stocké.
 * En production avec S3, retourner l'URL signée.
 */
function getFileUrl(relativePath) {
  const baseUrl = process.env.KYC_FILES_BASE_URL;
  if (baseUrl) {
    return `${baseUrl.replace(/\/$/, '')}/${relativePath}`;
  }
  // Fallback : chemin absolu local (accès admin uniquement via API)
  return path.join(UPLOAD_DIR, relativePath);
}

const LOGO_DIR = path.join(__dirname, '../../uploads/logos');
if (!fs.existsSync(LOGO_DIR)) fs.mkdirSync(LOGO_DIR, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, LOGO_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(allowed.includes(file.mimetype) ? null : new Error('Type non autorisé'), allowed.includes(file.mimetype));
  },
});

module.exports = { kycUpload, logoUpload, LOGO_DIR, toFileMetadata, getFileUrl, UPLOAD_DIR };
