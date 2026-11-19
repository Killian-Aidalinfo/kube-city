// Capture headless de /status : node scripts/shot-status.mjs <url> <fichier.png>
import { chromium } from 'playwright-core';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await chromium.launch({ executablePath: CHROME, headless: true });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto(process.argv[2]); await p.waitForTimeout(2500);
await p.screenshot({ path: process.argv[3] }); await b.close();
