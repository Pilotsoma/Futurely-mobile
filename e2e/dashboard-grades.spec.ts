import { expect, test } from './fixtures/app'

test('Dashboard and Grades share exact GPA formatting and re-sync state', async ({ page, mockApi }) => {
  await page.goto('/dashboard')

  const dashboardUnweighted = page.getByTestId('dashboard-gpa-card-unweighted')
  const dashboardWeighted = page.getByTestId('dashboard-gpa-card-weighted')
  await expect(dashboardUnweighted).toHaveText('3.875')
  await expect(dashboardWeighted).toHaveText('4.125')

  await page.goto('/grades')
  await expect(page.getByTestId('grades-gpa-card-unweighted')).toHaveText('3.875')
  await expect(page.getByTestId('grades-gpa-card-weighted')).toHaveText('4.125')

  await page.getByTestId('grades-gpa-card-sync').click()
  await expect(page.getByTestId('grades-gpa-card-unweighted')).toHaveText('3.925')
  await expect(page.getByTestId('grades-gpa-card-weighted')).toHaveText('4.175')
  expect(mockApi.requests.filter(({ path }) => path === '/integrations/grades/sync-profile')).toHaveLength(1)

  await page.goto('/dashboard')
  await expect(page.getByTestId('dashboard-gpa-card-unweighted')).toHaveText('3.925')
  await expect(page.getByTestId('dashboard-gpa-card-weighted')).toHaveText('4.175')
})

test('Dashboard due tile carries assignment ID and supports history, keyboard, and direct URLs', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByText('Quick Access', { exact: true })).toHaveCount(0)

  const dueTile = page.getByTestId('dashboard-due-tile-101')
  await expect(dueTile).toBeVisible()
  await dueTile.focus()
  await expect(dueTile).toBeFocused()
  await dueTile.press('Enter')
  await expect(page).toHaveURL(/\/planner\/101$/)
  await expect(page.getByTestId('planner-assignment-101')).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/dashboard$/)
  await dueTile.focus()
  await dueTile.press('Space')
  await expect(page).toHaveURL(/\/planner\/101$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.goForward()
  await expect(page).toHaveURL(/\/planner\/101$/)

  await page.goto('/planner/101')
  await expect(page.getByTestId('planner-assignment-101')).toBeVisible()

  await page.goto('/planner/not-an-id')
  await expect(page.getByRole('alert')).toContainText('The assignment link is invalid.')

  await page.goto('/planner/999')
  await expect(page.getByRole('alert')).toContainText('That assignment is no longer available.')
})

test('every Grades action tile and GPA card supports mouse and keyboard routing', async ({ page }) => {
  test.setTimeout(180_000)

  const routes = [
    ['Classwork', '/grades/classwork'],
    ['ReportCard', '/grades/report-card'],
    ['Schedule', '/grades/schedule'],
    ['GpaSimulator', '/grades/what-if'],
    ['ContactTeachers', '/grades/contact'],
    ['ProgressReport', '/grades/progress'],
    ['Transcript', '/grades/transcript'],
    ['Attendance', '/grades/attendance'],
    ['Roadmap', '/grades/roadmap'],
  ] as const

  for (const [index, [route, path]] of routes.entries()) {
    await page.goto('/grades')
    const tile = page.getByTestId(`grades-tile-${route}`)
    await tile.scrollIntoViewIfNeeded()
    await tile.click()
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`))

    await page.reload()
    await expect(page.getByRole('main')).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/\/grades$/)

    const keyboardTile = page.getByTestId(`grades-tile-${route}`)
    await keyboardTile.scrollIntoViewIfNeeded()
    await keyboardTile.focus()
    await expect(keyboardTile).toBeFocused()
    await keyboardTile.press(index % 2 === 0 ? 'Enter' : 'Space')
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`))
  }

  await page.goto('/grades')
  const gpaCard = page.getByTestId('grades-gpa-card')
  await gpaCard.click({ position: { x: 20, y: 150 } })
  await expect(page).toHaveURL(/\/grades\/what-if$/)
  await page.goBack()
  await gpaCard.focus()
  await expect(gpaCard).toBeFocused()
  await gpaCard.press('Enter')
  await expect(page).toHaveURL(/\/grades\/what-if$/)
})
