import { test, expect } from '@playwright/test';

const TEST_USER_PASSWORD = 'TestPassword123!';

test.describe('Authentication Flow', () => {
  test('should redirect to login when accessing protected route', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('should show login page with form fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Welcome Back')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
  });

  test('should have signup link on login page', async ({ page }) => {
    await page.goto('/login');
    const signupLink = page.locator('a:has-text("Sign up")');
    await expect(signupLink).toBeVisible();
    await signupLink.click();
    await expect(page).toHaveURL(/\/register/);
  });

  test('should show register page with form fields', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('div[data-slot="card-title"]:has-text("Create Account")')).toBeVisible();
    await expect(page.locator('#name')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#confirmPassword')).toBeVisible();
  });

  test('should register a new user and redirect to dashboard', async ({ page }) => {
    const timestamp = Date.now();
    const email = `test-${timestamp}@example.com`;

    await page.goto('/register');

    // Fill registration form
    await page.locator('#name').fill('Test User');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(TEST_USER_PASSWORD);
    await page.locator('#confirmPassword').fill(TEST_USER_PASSWORD);

    // Submit
    await page.locator('button:has-text("Create Account")').click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });
    await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 5000 });
  });

  test('should login with credentials', async ({ page, context }) => {
    // First create a user
    const timestamp = Date.now();
    const email = `login-test-${timestamp}@example.com`;

    // Register
    await page.goto('/register');
    await page.locator('#name').fill('Login Test User');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(TEST_USER_PASSWORD);
    await page.locator('#confirmPassword').fill(TEST_USER_PASSWORD);
    await page.locator('button:has-text("Create Account")').click();
    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });

    // Logout by clearing cookies
    await context.clearCookies();

    // Login again
    await page.goto('/login');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(TEST_USER_PASSWORD);
    await page.locator('button:has-text("Sign In")').click();

    // Should be on dashboard
    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });
    await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 5000 });
  });
});
