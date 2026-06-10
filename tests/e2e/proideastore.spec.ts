import { expect, test } from '@playwright/test';

test('homepage loads dossier cards and navigates to a hosted dossier page', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Not ideas. Diligence.' })).toBeVisible();
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

test('dossier detail page is readable on mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile readability check only runs in the mobile project');

  await page.goto('/dossiers/asx-filings-analyst/');

  await expect(page.getByRole('heading', { name: 'ASX Filings Analyst' })).toBeVisible();
  await expect(page.getByText('72 readiness')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to store' })).toBeVisible();
});
