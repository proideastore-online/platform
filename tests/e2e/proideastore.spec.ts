import { expect, test } from '@playwright/test';

test('homepage loads dossier cards and navigates to a hosted dossier page', async ({ page, isMobile }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Not ideas. Diligence.' })).toBeVisible();
  if (!isMobile) {
    await expect(page.locator('nav').getByRole('link', { name: 'Contributors', exact: true })).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: 'Console', exact: true })).toBeVisible();
  }
  const asxCard = page.locator('article.card').filter({ hasText: 'ASX Filings Analyst' });
  await expect(asxCard).toBeVisible();
  await expect(asxCard).toContainText('Australian retail investors');

  await asxCard.getByRole('link', { name: 'Open dossier' }).click();

  await expect(page).toHaveURL(/\/dossiers\/asx-filings-analyst\/$/);
  await expect(page.getByRole('heading', { name: 'ASX Filings Analyst' })).toBeVisible();
  await expect(page.getByText('Curated opportunity dossier')).toBeVisible();
  await expect(page.getByText('research memo')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Diligence Notes' })).toBeVisible();
});

test('contributors and console pages are available', async ({ page }) => {
  await page.goto('/contributors/', { waitUntil: 'networkidle' });

  await expect(page.getByText('Contributor reputation.')).toBeVisible();
  await expect(page.getByText('Diligence Lead')).toBeVisible();

  await page.goto('/console/');

  await expect(page.getByRole('heading', { name: 'Build an opportunity packet.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create dossier' })).toBeVisible();
});

test('dossier detail page is readable on mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile readability check only runs in the mobile project');

  await page.goto('/dossiers/asx-filings-analyst/');

  await expect(page.getByRole('heading', { name: 'ASX Filings Analyst' })).toBeVisible();
  await expect(page.getByText('72 readiness')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to store' })).toBeVisible();
});
