import { expect, test } from '@playwright/test'

async function openPage(page: import('@playwright/test').Page, path: string) {
  await page.goto(path)
  await page.waitForFunction(() => Boolean((document.querySelector('#app') as HTMLElement & { __vue_app__?: unknown })?.__vue_app__))
}

test('Japanese and English pages load and language menu reaches the matching guide', async ({ page }) => {
  await openPage(page, './')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Redmine Kanban Manual')
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible()
  const englishManual = page.locator('.manual-entry a').first()
  await expect(englishManual).toHaveText('Open the English manual')
  await englishManual.click()
  await expect(page).toHaveURL(/\/en\/$/)
  await openPage(page, './')
  await page.getByRole('link', { name: /日本語版マニュアルを開く/ }).click()
  await expect(page).toHaveURL(/\/ja\/$/)

  await openPage(page, 'ja/guide/introduction')
  await expect(page.locator('main')).toContainText(/Redmine Kanban/)
  await expect(page.locator('.manual-scope')).toContainText('v0.8.0')

  await page.getByRole('button', { name: /change language/i }).click()
  await page.getByRole('link', { name: 'English' }).click()
  await expect(page).toHaveURL(/\/en\/guide\/introduction(?:\.html)?$/)
  await expect(page.locator('main')).toContainText(/Redmine Kanban/)

  await page.getByRole('button', { name: /change language/i }).click()
  await page.getByRole('link', { name: /日本語/ }).click()
  await expect(page).toHaveURL(/\/ja\/guide\/introduction(?:\.html)?$/)
})

test('site search finds manual content and dark mode can be toggled', async ({ page }) => {
  await openPage(page, 'en/')

  await page.getByRole('button', { name: /search/i }).click()
  const search = page.locator('#localsearch-input')
  await search.fill('installation')
  const result = page.locator('.VPLocalSearchBox .result').first()
  await expect(result).toContainText(/installation/i)
  await result.click()
  await expect(page).toHaveURL(/\/en\/guide\/installation(?:\.html)?(?:#.*)?$/)

  await openPage(page, 'ja/')
  await page.getByRole('button', { name: /検索/ }).click()
  await page.locator('#localsearch-input').fill('基本操作')
  const japaneseResult = page.locator('.VPLocalSearchBox .result').first()
  await expect(japaneseResult).toContainText(/基本操作/)
  await japaneseResult.click()
  await expect(page).toHaveURL(/\/ja\/guide\/basic-operations(?:\.html)?(?:#.*)?$/)

  const darkModeToggle = page.locator('.VPSwitchAppearance').first()
  await darkModeToggle.click()
  await expect(page.locator('html')).toHaveClass(/dark/)
})

test('manual image remains visible on a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openPage(page, 'ja/')

  const image = page.locator('main img').first()
  await expect(image).toBeVisible()
  await expect.poll(async () => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)

  await page.getByRole('button', { name: 'mobile navigation' }).click()
  await expect(page.locator('#VPNavScreen')).toBeVisible()
  await expect(page.locator('#VPNavScreen').getByRole('link', { name: 'ガイド', exact: true })).toBeVisible()
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})

test('overview and feature images load successfully across pages', async ({ page }) => {
  const pagesToCheck = [
    { url: 'ja/', image: 'kanban-overview-ja.png' },
    { url: 'en/', image: 'kanban-overview-en.png' },
    { url: 'ja/features/swimlanes', image: 'swimlanes-ja.png' },
    { url: 'en/features/swimlanes', image: 'swimlanes-en.png' },
    { url: 'ja/features/aging', image: 'aging-ja.png' },
    { url: 'en/features/aging', image: 'aging-en.png' },
    { url: 'ja/features/saved-views', image: 'saved-views-ja.png' },
    { url: 'en/features/saved-views', image: 'saved-views-en.png' },
    { url: 'ja/features/display-settings', image: 'display-settings-ja.png' },
    { url: 'en/features/display-settings', image: 'display-settings-en.png' },
    { url: 'ja/administration/permissions', image: 'permissions-ja.png' },
    { url: 'en/administration/permissions', image: 'permissions-en.png' },
  ]

  for (const item of pagesToCheck) {
    await openPage(page, item.url)
    const img = page.locator(`main img[src$="${item.image}"]`)
    await expect(img).toBeVisible()
    await expect.poll(async () => img.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  }
})

test('video and poster element render correctly on basic operations pages', async ({ page }) => {
  for (const locale of ['ja', 'en']) {
    await openPage(page, `${locale}/guide/basic-operations`)
    const video = page.locator('main video')
    await expect(video).toBeVisible()
    await expect(video).toHaveAttribute('poster', new RegExp(`kanban-drag-poster-${locale}\\.png$`))
    await expect(video).toHaveAttribute('src', new RegExp(`/redmine_kanban/videos/kanban-drag-${locale}\\.mp4$`))
  }
})
