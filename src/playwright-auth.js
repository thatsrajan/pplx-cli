import { chromium } from 'playwright';
import { BASE_URL, HEADERS } from './constants.js';
import readline from 'readline';

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

export async function extractFromPlaywright(opts = {}) {
  const headless = opts.headless === true;
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent: HEADERS['user-agent'],
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  if (!headless) {
    await waitForEnter('Log in to Perplexity in the opened browser, then press Enter here to continue...');
  } else {
    // Give headless a moment in case cookies are already present.
    await page.waitForTimeout(3000);
  }

  const cookies = await context.cookies(BASE_URL);
  await browser.close();

  const out = {};
  for (const c of cookies) out[c.name] = c.value;
  return out;
}
