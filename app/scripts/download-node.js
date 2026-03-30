const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const NODE_VERSION = '20.18.3'; // LTS

// Detect current platform or use args
const platform = process.argv[2] || process.platform; // darwin, win32, linux
const arch = process.argv[3] || process.arch; // arm64, x64

const TARGETS = {
  'darwin-arm64': {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    format: 'tar.gz',
    binary: `node-v${NODE_VERSION}-darwin-arm64/bin/node`,
  },
  'darwin-x64': {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    format: 'tar.gz',
    binary: `node-v${NODE_VERSION}-darwin-x64/bin/node`,
  },
  'win32-x64': {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`,
    format: 'zip',
    binary: `node-v${NODE_VERSION}-win-x64/node.exe`,
  },
  'linux-x64': {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz`,
    format: 'tar.gz',
    binary: `node-v${NODE_VERSION}-linux-x64/bin/node`,
  },
};

const key = `${platform}-${arch}`;
const target = TARGETS[key];
if (!target) {
  console.error(`Unsupported platform: ${key}`);
  console.error(`Supported: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

const outputDir = path.join(__dirname, '..', 'dist', 'node');
const outputBin = path.join(outputDir, platform === 'win32' ? 'node.exe' : 'node');

// Skip if already downloaded
if (fs.existsSync(outputBin)) {
  try {
    const version = execSync(`"${outputBin}" --version`, { encoding: 'utf8' }).trim();
    if (version === `v${NODE_VERSION}`) {
      console.log(`Node.js ${version} already downloaded at ${outputBin}`);
      process.exit(0);
    }
  } catch (e) {
    // Binary exists but doesn't work, re-download
  }
}

fs.mkdirSync(outputDir, { recursive: true });

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-download-'));
const archiveFile = path.join(tmpDir, target.format === 'zip' ? 'node.zip' : 'node.tar.gz');

console.log(`Downloading Node.js v${NODE_VERSION} for ${key}...`);
console.log(`URL: ${target.url}`);

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const request = (url.startsWith('https') ? https : http).get(url, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(response.headers.location, dest).then(resolve, reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'], 10);
      let downloadedBytes = 0;
      let lastPercent = -1;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes) {
          const percent = Math.floor((downloadedBytes / totalBytes) * 100);
          if (percent !== lastPercent && percent % 10 === 0) {
            lastPercent = percent;
            process.stdout.write(`  ${percent}%\n`);
          }
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close(resolve);
      });
    });

    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function extractBinary() {
  if (target.format === 'tar.gz') {
    // Extract only the node binary from the tarball
    console.log('Extracting node binary from tar.gz...');
    execSync(`tar -xzf "${archiveFile}" -C "${tmpDir}" "${target.binary}"`, { stdio: 'inherit' });

    const extractedBin = path.join(tmpDir, target.binary);
    if (!fs.existsSync(extractedBin)) {
      throw new Error(`Binary not found at expected path: ${extractedBin}`);
    }

    fs.copyFileSync(extractedBin, outputBin);
    fs.chmodSync(outputBin, 0o755);
  } else if (target.format === 'zip') {
    // Extract only node.exe from the zip
    console.log('Extracting node.exe from zip...');

    // Use PowerShell on Windows, unzip on others
    if (process.platform === 'win32') {
      execSync(
        `powershell -Command "Expand-Archive -Path '${archiveFile}' -DestinationPath '${tmpDir}' -Force"`,
        { stdio: 'inherit' }
      );
    } else {
      execSync(`unzip -o "${archiveFile}" "${target.binary}" -d "${tmpDir}"`, { stdio: 'inherit' });
    }

    const extractedBin = path.join(tmpDir, target.binary);
    if (!fs.existsSync(extractedBin)) {
      throw new Error(`Binary not found at expected path: ${extractedBin}`);
    }

    fs.copyFileSync(extractedBin, outputBin);
  }
}

function cleanup() {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) {
    // Ignore cleanup errors
  }
}

async function main() {
  try {
    await download(target.url, archiveFile);
    console.log('Download complete.');

    await extractBinary();
    cleanup();

    // Verify the binary works
    const version = execSync(`"${outputBin}" --version`, { encoding: 'utf8' }).trim();
    const stat = fs.statSync(outputBin);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);

    console.log('');
    console.log(`Node.js binary ready:`);
    console.log(`  Path: ${outputBin}`);
    console.log(`  Version: ${version}`);
    console.log(`  Size: ${sizeMB} MB`);
  } catch (err) {
    cleanup();
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
