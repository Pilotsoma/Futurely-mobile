import { expect, test } from './fixtures/app'

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`Dashboard remains usable at ${viewport.name} width`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-gpa-card')).toBeVisible()
    await expect(page.getByTestId('dashboard-due-tile-101')).toBeVisible()
    await expect(page.getByLabel('Ask myFuturely AI')).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath(`dashboard-${viewport.name}.png`),
      fullPage: true,
    })
  })
}
