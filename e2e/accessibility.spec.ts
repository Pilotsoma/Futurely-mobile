import AxeBuilder from '@axe-core/playwright'

import { expect, test } from './fixtures/app'

for (const path of ['/dashboard', '/grades', '/ai', '/settings']) {
  test(`${path} has no serious or critical automated WCAG violations`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('main')).toBeVisible()
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    const blockers = results.violations.filter(
      ({ impact }) => impact === 'serious' || impact === 'critical',
    )
    expect(blockers).toEqual([])
  })
}
