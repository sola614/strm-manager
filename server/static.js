import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

export function mountStaticFiles(app, distPath) {
  if (!fs.existsSync(path.join(distPath, 'index.html'))) return;

  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
