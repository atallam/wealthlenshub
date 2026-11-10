/**
 * uploads.js - multer helpers.
 *
 * allowExtensions([...]) returns a multer `fileFilter` that rejects other file
 * types *before* the body is buffered into memory, with a 400 the global API
 * error handler turns into JSON. Extension-based on purpose: browsers report
 * unreliable MIME types for CSV/Excel on Windows. Handlers still validate content.
 */
export function allowExtensions(exts) {
  const allowed = new Set(exts.map(e => e.toLowerCase()));
  const label = [...allowed].map(e => "." + e).join(", ");
  return (_req, file, cb) => {
    const ext = String(file?.originalname || "").split(".").pop().toLowerCase();
    if (allowed.has(ext)) return cb(null, true);
    cb(Object.assign(new Error(`Unsupported file type. Allowed: ${label}`), { status: 400 }));
  };
}
