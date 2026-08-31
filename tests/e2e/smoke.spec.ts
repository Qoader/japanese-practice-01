import { test, expect } from '@playwright/test';
test('home and setup are usable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('おかえりなさい')).toBeVisible();
  await page.getByText('Start lesson').click();
  await expect(
    page.getByRole('heading', { name: 'Lesson setup' }),
  ).toBeVisible();
});

test('GitHub token is saved explicitly and can be cleared', async ({
  page,
}) => {
  await page.goto('/#/settings');
  const token = page.getByLabel('GitHub token');
  const save = page.getByRole('button', { name: 'Save token' });

  await expect(page.getByText('No GitHub token configured.')).toBeVisible();
  await expect(save).toBeDisabled();
  await token.fill('ghp-example-token');
  expect(
    await page.evaluate(() => localStorage.getItem('github-token')),
  ).toBeNull();
  await save.click();
  await expect(page.getByRole('status')).toHaveText('Token saved.');
  await expect(page.getByText('GitHub token configured.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('github-token'))).toBe(
    'ghp-example-token',
  );

  await page.getByRole('button', { name: 'Clear token' }).click();
  await expect(page.getByRole('status')).toHaveText('Token cleared.');
  await expect(page.getByText('No GitHub token configured.')).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('github-token')),
  ).toBeNull();
  await expect(token).toHaveValue('');
});

test('existing GitHub token is detected without exposing it', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem('github-token', 'ghp-existing-secret'),
  );
  await page.goto('/#/settings');

  await expect(page.getByText('GitHub token configured.')).toBeVisible();
  await expect(page.getByLabel('GitHub token')).toHaveValue('');
  await expect(page.getByLabel('GitHub token')).not.toHaveAttribute(
    'value',
    'ghp-existing-secret',
  );
});

test('token save errors do not claim success or change configured state', async ({
  page,
}) => {
  await page.goto('/#/settings');
  const token = page.getByLabel('GitHub token');
  await token.fill('ghp-example-token');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('storage unavailable');
    };
  });

  await page.getByRole('button', { name: 'Save token' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Unable to save the token in this browser. Your token was not changed.',
  );
  await expect(page.getByText('No GitHub token configured.')).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('github-token')),
  ).toBeNull();
  await expect(token).toHaveValue('ghp-example-token');
});
