import { execSync } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imagesDir = path.resolve(__dirname, '../public/images');
const videosDir = path.resolve(__dirname, '../public/videos');
const rawVideoDir = '/tmp/kanban-raw-recordings';
const baseURL = process.env.REDMINE_URL || 'http://127.0.0.1:3000';

await mkdir(imagesDir, { recursive: true });
await mkdir(videosDir, { recursive: true });
await mkdir(rawVideoDir, { recursive: true });

async function seedData(locale) {
  console.log(`Seeding demo data for locale: ${locale}...`);
  execSync(
    `docker exec -e MANUAL_CAPTURE_LOCALE=${locale} redmine-dev-7 bundle exec rails runner plugins/redmine_kanban/website/scripts/manual-demo.rb`,
    { stdio: 'inherit' }
  );
}

async function captureLocale(locale) {
  console.log(`\n========================================`);
  console.log(`Starting capture for locale: ${locale}`);
  console.log(`========================================`);

  await seedData(locale);

  // Clear previous raw recordings
  const existingFiles = await readdir(rawVideoDir).catch(() => []);
  for (const f of existingFiles) {
    await rm(path.join(rawVideoDir, f), { force: true });
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 850 },
    locale: locale === 'ja' ? 'ja-JP' : 'en-US',
    recordVideo: { dir: rawVideoDir, size: { width: 1440, height: 850 } },
  });

  const recordingStartedAt = Date.now();
  const page = await context.newPage();

  // Login
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('admin');
  await page.getByRole('button', { name: /login|sign in|ログイン/i }).click();
  await page.waitForURL(url => !url.pathname.includes('/login'));

  // Open Kanban
  await page.goto(`${baseURL}/projects/kanban-demo/kanban`);
  await page.waitForSelector('#redmine-kanban-root canvas', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // 1. Overview screenshot (target #redmine-kanban-root to exclude Redmine top bar/admin header)
  const root = page.locator('#redmine-kanban-root');
  const overviewPath = path.join(imagesDir, `kanban-overview-${locale}.png`);
  await root.screenshot({ path: overviewPath });
  console.log(`Captured: ${overviewPath}`);

  // 2. Display Settings popover & dialog sizing section
  const settingsBtn = page.locator('button[aria-label*="表示設定"], button[aria-label*="Display settings"], button:has(.rk-icon:text("tune"))').first();
  await settingsBtn.click();
  await page.waitForTimeout(600);
  const settingsMenu = page.locator('.rk-settings-menu');
  const settingsPath = path.join(imagesDir, `display-settings-${locale}.png`);
  await settingsMenu.screenshot({ path: settingsPath });
  console.log(`Captured: ${settingsPath}`);

  // Dialog sizing sub-panel screenshot
  const dialogGroup = settingsMenu.locator('div[role="group"]').first();
  const dialogSettingsPath = path.join(imagesDir, `issue-dialog-settings-${locale}.png`);
  if (await dialogGroup.isVisible()) {
    await dialogGroup.screenshot({ path: dialogSettingsPath });
    console.log(`Captured: ${dialogSettingsPath}`);
  }

  // 3. Swimlanes: switch to Assignee lane
  const laneSelect = settingsMenu.locator('select').first();
  await laneSelect.selectOption('assignee');
  await page.waitForTimeout(800);
  await settingsBtn.click(); // Close settings
  await page.waitForTimeout(800);
  const swimlanesPath = path.join(imagesDir, `swimlanes-${locale}.png`);
  await root.screenshot({ path: swimlanesPath });
  console.log(`Captured: ${swimlanesPath}`);

  // Reset lane back to none for drag video
  await settingsBtn.click();
  await page.waitForTimeout(400);
  await laneSelect.selectOption('none');
  await page.waitForTimeout(600);
  await settingsBtn.click(); // Close settings
  await page.waitForTimeout(800);

  // 4. Saved views popover
  const savedViewsBtn = page.locator('button.rk-saved-views-trigger');
  await savedViewsBtn.click();
  await page.waitForTimeout(600);
  const savedViewsMenu = page.locator('.rk-saved-views');
  const savedViewsPath = path.join(imagesDir, `saved-views-${locale}.png`);
  await savedViewsMenu.screenshot({ path: savedViewsPath });
  console.log(`Captured: ${savedViewsPath}`);
  await savedViewsBtn.click(); // Close
  await page.waitForTimeout(600);

  // 5. Aging detection screenshot (focus on cards area)
  const canvas = page.locator('#redmine-kanban-root canvas').first();
  const agingPath = path.join(imagesDir, `aging-${locale}.png`);
  await canvas.screenshot({ path: agingPath });
  console.log(`Captured: ${agingPath}`);

  // 6. Drag & Drop interaction (recorded in video)
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Kanban canvas is not visible");
  const dragStartedAt = (Date.now() - recordingStartedAt) / 1000;
  {
    const sourceX = box.x + 100;
    const sourceY = box.y + 80;
    const targetX = box.x + 400;
    const targetY = box.y + 80;

    await page.waitForTimeout(1000);
    await page.mouse.move(sourceX, sourceY);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 30 });
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await page.waitForTimeout(2000);
  }

  const dragDuration = (Date.now() - recordingStartedAt) / 1000 - dragStartedAt;

  // 7. Permissions screenshot
  await page.goto(`${baseURL}/roles/permissions`);
  await page.waitForLoadState('networkidle');
  const kanbanRow = page.locator('tr:has-text("Kanban")').first();
  const permissionsPath = path.join(imagesDir, `permissions-${locale}.png`);
  if (await kanbanRow.isVisible()) {
    await kanbanRow.scrollIntoViewIfNeeded();
    await kanbanRow.screenshot({ path: permissionsPath });
    console.log(`Captured: ${permissionsPath}`);
  }

  // Close context to finalize video recording
  await page.close();
  await context.close();
  await browser.close();

  // Find recorded webm file
  const recordedFiles = (await readdir(rawVideoDir)).filter(f => f.endsWith('.webm'));
  if (recordedFiles.length > 0) {
    const webmFile = path.join(rawVideoDir, recordedFiles[0]);
    const mp4Path = path.join(videosDir, `kanban-drag-${locale}.mp4`);
    const posterPath = path.join(imagesDir, `kanban-drag-poster-${locale}.png`);

    console.log(`Converting ${webmFile} to ${mp4Path} (cropping to Kanban board area)...`);
    execSync(`ffmpeg -y -i "${webmFile}" -ss ${dragStartedAt.toFixed(3)} -t ${dragDuration.toFixed(3)} -vf "crop=1400:710:20:140" -c:v libx264 -pix_fmt yuv420p -movflags +faststart -an "${mp4Path}"`);
    execSync(`ffmpeg -y -i "${mp4Path}" -ss 0 -vframes 1 "${posterPath}"`);
    console.log(`Video and poster created: ${mp4Path}, ${posterPath}`);

    if (locale === 'ja') {
      const gifPath = path.resolve(__dirname, '../../images/demo-current.gif');
      console.log(`Generating demo GIF: ${gifPath}...`);
      execSync(`ffmpeg -y -i "${mp4Path}" -vf "fps=10,scale=1000:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${gifPath}"`);
      console.log(`Demo GIF generated: ${gifPath}`);
    }
  }
}

for (const loc of ['ja', 'en']) {
  await captureLocale(loc);
}

console.log('\nAll captures successfully finished!');
