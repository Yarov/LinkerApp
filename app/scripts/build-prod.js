const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist', 'server');

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

console.log('=== Building Linker for production ===');

// 1. Build Next.js in standalone mode
console.log('[1/6] Building Next.js standalone...');
execSync('npm run build', { stdio: 'inherit', cwd: rootDir });

// 2. Prepare clean output directory
console.log('[2/6] Preparing output directory...');
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}
fs.mkdirSync(distDir, { recursive: true });

// 3. Copy standalone server output
console.log('[3/6] Copying standalone server...');
const standaloneDir = path.join(rootDir, '.next', 'standalone');
if (!fs.existsSync(standaloneDir)) {
  console.error('ERROR: .next/standalone not found. Make sure next.config.ts has output: "standalone"');
  process.exit(1);
}
copyDir(standaloneDir, distDir);

// 4. Copy static assets (standalone doesn't include these)
console.log('[4/6] Copying static assets...');
const staticSrc = path.join(rootDir, '.next', 'static');
const staticDst = path.join(distDir, '.next', 'static');
if (fs.existsSync(staticSrc)) {
  fs.mkdirSync(path.dirname(staticDst), { recursive: true });
  copyDir(staticSrc, staticDst);
} else {
  console.warn('WARNING: .next/static not found, skipping');
}

const publicSrc = path.join(rootDir, 'public');
if (fs.existsSync(publicSrc)) {
  copyDir(publicSrc, path.join(distDir, 'public'));
}

// 5. Copy database, env, and prisma schema
console.log('[5/6] Copying database, env, and prisma files...');

// Copy SQLite database as initial data (will be copied to app data dir at runtime)
const dbSrc = path.join(rootDir, 'dev.db');
if (fs.existsSync(dbSrc)) {
  fs.copyFileSync(dbSrc, path.join(distDir, 'dev.db'));
  console.log('  - Copied dev.db');
} else {
  const dbSrcAlt = path.join(rootDir, 'prisma', 'dev.db');
  if (fs.existsSync(dbSrcAlt)) {
    fs.copyFileSync(dbSrcAlt, path.join(distDir, 'dev.db'));
    console.log('  - Copied prisma/dev.db');
  } else {
    console.warn('  WARNING: No dev.db found');
  }
}

// Copy .env for production defaults
const envSrc = path.join(rootDir, '.env.production');
const envFallback = path.join(rootDir, '.env');
if (fs.existsSync(envSrc)) {
  fs.copyFileSync(envSrc, path.join(distDir, '.env'));
  console.log('  - Copied .env.production as .env');
} else if (fs.existsSync(envFallback)) {
  fs.copyFileSync(envFallback, path.join(distDir, '.env'));
  console.log('  - Copied .env');
}

// Copy prisma schema (needed for runtime query engine)
const prismaSchemaSrc = path.join(rootDir, 'prisma', 'schema.prisma');
if (fs.existsSync(prismaSchemaSrc)) {
  const prismaDir = path.join(distDir, 'prisma');
  fs.mkdirSync(prismaDir, { recursive: true });
  fs.copyFileSync(prismaSchemaSrc, path.join(prismaDir, 'schema.prisma'));
  console.log('  - Copied prisma/schema.prisma');
}

// 6. Verify server.js exists
console.log('[6/6] Verifying build...');
const serverJs = path.join(distDir, 'server.js');
if (!fs.existsSync(serverJs)) {
  console.error('ERROR: server.js not found in output. Build may have failed.');
  process.exit(1);
}

console.log('');
console.log('=== Production build complete! ===');
console.log(`Output: ${distDir}`);
console.log('Entry point: dist/server/server.js');
