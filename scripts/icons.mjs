// Erzeugt PNG-Icons aus public/icon.svg (benötigt Playwright/Chromium)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const svg = readFileSync('public/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [size, out] of [[180, 'public/apple-touch-icon.png'], [192, 'public/icon-192.png'], [512, 'public/icon-512.png']]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#12171b">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: out, omitBackground: false });
}
await browser.close();
console.log('Icons erzeugt');
