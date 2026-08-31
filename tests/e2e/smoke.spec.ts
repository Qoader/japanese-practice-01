import { test, expect } from '@playwright/test';
test('home and setup are usable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('おかえりなさい')).toBeVisible();
  await page.getByText('Start lesson').click();
  await expect(
    page.getByRole('heading', { name: 'Lesson setup' }),
  ).toBeVisible();
});
