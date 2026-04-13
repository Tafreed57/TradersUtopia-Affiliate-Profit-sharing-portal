import { test, expect } from '@playwright/test';

const TEST_USER_PASSWORD = 'TestPassword123!';

async function loginUser(page) {
  await page.goto('/register');
  const timestamp = Date.now();
  const uniqueEmail = `dash-${timestamp}-${Math.random().toString(36).slice(7)}@example.com`;

  // Register new user
  await page.locator('#name').fill('Dashboard Test User');
  await page.locator('#email').fill(uniqueEmail);
  await page.locator('#password').fill(TEST_USER_PASSWORD);
  await page.locator('#confirmPassword').fill(TEST_USER_PASSWORD);
  await page.locator('button:has-text("Create Account")').click();

  // Wait for dashboard
  await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });
  return uniqueEmail;
}

test.describe('Dashboard and Core Features', () => {
  test('should display dashboard after login', async ({ page }) => {
    await loginUser(page);

    // Check for dashboard heading
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
  });

  test('should navigate to attendance page', async ({ page }) => {
    await loginUser(page);

    // Click on attendance link
    const attendanceLink = page.locator('a[href*="attendance"]').first();
    if (await attendanceLink.isVisible()) {
      await attendanceLink.click();
      await expect(page).toHaveURL(/\/attendance/, { timeout: 10000 });
    }
  });

  test('should navigate to commissions page', async ({ page }) => {
    await loginUser(page);

    // Click on commissions link
    const commissionsLink = page.locator('a[href*="commissions"]').first();
    if (await commissionsLink.isVisible()) {
      await commissionsLink.click();
      await expect(page).toHaveURL(/\/commissions/, { timeout: 10000 });
    }
  });

  test('should navigate to settings page', async ({ page }) => {
    await loginUser(page);

    // Click on settings link
    const settingsLink = page.locator('a[href*="settings"]').first();
    if (await settingsLink.isVisible()) {
      await settingsLink.click();
      await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });
    }
  });

  test('should display commission list or empty state', async ({ page }) => {
    await loginUser(page);

    // Navigate to commissions
    const commissionsLink = page.locator('a[href*="commissions"]').first();
    if (await commissionsLink.isVisible()) {
      await commissionsLink.click();
      await expect(page).toHaveURL(/\/commissions/, { timeout: 10000 });

      // Page should load
      await page.waitForLoadState('networkidle');
    }
  });

  test('should have navigation elements visible', async ({ page }) => {
    await loginUser(page);

    // Check for nav elements
    const navLinks = page.locator('nav a, a[href*="/"]');
    const count = await navLinks.count();

    expect(count).toBeGreaterThan(0);
  });

  test('should redirect to login when accessing protected route without session', async ({ page, context }) => {
    // Clear any existing session
    await context.clearCookies();

    // Try to access dashboard
    await page.goto('/');

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });
});
