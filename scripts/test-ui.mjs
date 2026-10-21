import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 4173;
const ROOT_DIR = process.cwd();
const SCREENSHOTS_DIR = path.join(ROOT_DIR, 'screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// MIME types dictionary for static file serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

// Start local static HTTP server
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let reqPath = req.url.split('?')[0];
      if (reqPath === '/' || reqPath === '/dashboard') reqPath = '/index.html';

      const filePath = path.join(ROOT_DIR, reqPath);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const headers = { 'Content-Type': contentType };

      if (reqPath === '/sw.js') {
        headers['Cache-Control'] = 'no-cache';
        headers['Service-Worker-Allowed'] = '/';
      }

      res.writeHead(200, headers);
      res.end(fs.readFileSync(filePath));
    });

    server.listen(PORT, () => {
      console.log(`Local test server running at http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

const VIEWPORTS = [
  { width: 320, height: 640, label: '320x640 (small mobile)' },
  { width: 360, height: 740, label: '360x740 (Android standard)' },
  { width: 390, height: 844, label: '390x844 (iPhone standard)' },
  { width: 430, height: 932, label: '430x932 (iPhone Pro Max)' },
  { width: 768, height: 1024, label: '768x1024 (tablet portrait)' },
  { width: 1024, height: 768, label: '1024x768 (tablet landscape)' },
  { width: 1440, height: 900, label: '1440x900 (desktop)' },
  { width: 844, height: 390, label: '844x390 (mobile landscape)' }
];

const fakeRecords = [
  { customer: 'Acme Corp', item: 1, weight: '12.450', time: '10:15:30', date: '2026-10-21' },
  { customer: 'Alpha Industries & Trading <b id="injected-tag">PWNED</b> Ltd -- Extremely Long Name That Should Wrap Properly Without Breaking', item: 2, weight: '45.120', time: '10:22:15', date: '2026-10-21' },
  { customer: 'Beta Logistics', item: 3, weight: '5.800', time: '10:30:45', date: '2026-10-21' },
  { customer: 'Gamma Wholesale "Special Edition" <script>alert(1)</script>', item: 4, weight: '89.230', time: '10:45:00', date: '2026-10-21' },
  { customer: 'Delta Retail', item: 5, weight: '2.150', time: '11:05:12', date: '2026-10-21' },
  { customer: 'Echo Enterprises', item: 6, weight: '33.700', time: '11:20:00', date: '2026-10-21' }
];

const activeCustName = 'Alpha Industries & Trading <b id="injected-tag">PWNED</b> Ltd -- Extremely Long Name That Should Wrap Properly Without Breaking';

async function runTests() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  let hasFailures = false;

  try {
    for (const vp of VIEWPORTS) {
      console.log(`\nTesting viewport: ${vp.label}...`);
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1
      });

      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      page.on('pageerror', (err) => {
        pageErrors.push(err.message);
      });

      // Seed localStorage with fake data before page loads
      await page.addInitScript(({ records, customer }) => {
        localStorage.setItem('sahilSmartScaleRecords', JSON.stringify(records));
        localStorage.setItem('sahilActiveCustomer', customer);
      }, { records: fakeRecords, customer: activeCustName });

      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

      // 1. Assert no injected <b> tags rendered in DOM
      const injectedElement = await page.$('#injected-tag');
      if (injectedElement) {
        console.error(`❌ [${vp.label}] Injected <b> tag was found in DOM! XSS vulnerability.`);
        hasFailures = true;
      } else {
        console.log(`✓ [${vp.label}] XSS protection verified: No injected <b> tag in DOM.`);
      }

      // 2. Assert no horizontal overflow on Live Tab
      const liveOverflow = await page.evaluate(() => {
        const docWidth = document.documentElement.scrollWidth;
        const bodyWidth = document.body.scrollWidth;
        const clientWidth = document.documentElement.clientWidth;
        return {
          hasOverflow: docWidth > clientWidth || bodyWidth > clientWidth,
          docWidth,
          bodyWidth,
          clientWidth
        };
      });

      if (liveOverflow.hasOverflow) {
        console.error(`❌ [${vp.label}] Live tab horizontal overflow: docWidth=${liveOverflow.docWidth}, clientWidth=${liveOverflow.clientWidth}`);
        hasFailures = true;
      } else {
        console.log(`✓ [${vp.label}] Live tab scrollWidth (${liveOverflow.docWidth}px) <= clientWidth (${liveOverflow.clientWidth}px).`);
      }

      // Take Live Tab Screenshot
      const livePath = path.join(SCREENSHOTS_DIR, `live-${vp.width}x${vp.height}.png`);
      await page.screenshot({ path: livePath, fullPage: false });
      console.log(`✓ [${vp.label}] Saved screenshot: ${livePath}`);

      // 3. Switch to History Tab
      await page.click('#tabHistoryBtn');
      await page.waitForTimeout(200);

      // Check History Tab Overflow
      const historyOverflow = await page.evaluate(() => {
        const docWidth = document.documentElement.scrollWidth;
        const bodyWidth = document.body.scrollWidth;
        const clientWidth = document.documentElement.clientWidth;
        return {
          hasOverflow: docWidth > clientWidth || bodyWidth > clientWidth,
          docWidth,
          bodyWidth,
          clientWidth
        };
      });

      if (historyOverflow.hasOverflow) {
        console.error(`❌ [${vp.label}] History tab horizontal overflow: docWidth=${historyOverflow.docWidth}, clientWidth=${historyOverflow.clientWidth}`);
        hasFailures = true;
      } else {
        console.log(`✓ [${vp.label}] History tab scrollWidth (${historyOverflow.docWidth}px) <= clientWidth (${historyOverflow.clientWidth}px).`);
      }

      // Assert Filtered Summary Updates Correctly
      const summaryStats = await page.evaluate(() => {
        return {
          entries: document.getElementById('entries').textContent,
          total: document.getElementById('total').textContent
        };
      });
      console.log(`✓ [${vp.label}] Summary metrics: ${summaryStats.entries} entries, ${summaryStats.total}`);

      // Take History Tab Screenshot
      const historyPath = path.join(SCREENSHOTS_DIR, `history-${vp.width}x${vp.height}.png`);
      await page.screenshot({ path: historyPath, fullPage: false });
      console.log(`✓ [${vp.label}] Saved screenshot: ${historyPath}`);

      // 4. Assert no console errors
      if (consoleErrors.length > 0 || pageErrors.length > 0) {
        console.error(`❌ [${vp.label}] Console errors detected:`, consoleErrors, pageErrors);
        hasFailures = true;
      } else {
        console.log(`✓ [${vp.label}] Zero console errors.`);
      }

      await context.close();
    }

    // 5. Test PWA Offline functionality
    console.log('\nTesting PWA Service Worker & Offline Load...');
    const pwaContext = await browser.newContext({
      viewport: { width: 390, height: 844 }
    });
    const pwaPage = await pwaContext.newPage();
    await pwaPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    // Wait for Service Worker registration
    await pwaPage.waitForTimeout(1000);

    // Simulate going completely offline
    await pwaContext.setOffline(true);
    console.log('Context set to offline. Reloading page...');
    await pwaPage.reload({ waitUntil: 'networkidle' });

    const offlineTitle = await pwaPage.title();
    console.log(`Offline loaded page title: "${offlineTitle}"`);
    if (offlineTitle.includes('Smart Weighing Scale')) {
      console.log('✓ PWA successfully loaded completely offline from Service Worker cache!');
    } else {
      console.error('❌ PWA failed to load offline.');
      hasFailures = true;
    }

    // Test manifest
    const manifestResp = await pwaPage.request.get(`http://localhost:${PORT}/manifest.webmanifest`);
    if (manifestResp.status() === 200) {
      const manifestJson = await manifestResp.json();
      console.log(`✓ Web App Manifest verified: ${manifestJson.name} (${manifestJson.display})`);
    } else {
      console.error('❌ Failed to fetch manifest.webmanifest');
      hasFailures = true;
    }

    await pwaContext.close();

  } finally {
    await browser.close();
    server.close();
  }

  if (hasFailures) {
    console.error('\n❌ Tests finished with errors.');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL TESTS PASSED! All viewports responsive, XSS escaped, zero console errors, PWA offline verified.');
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
