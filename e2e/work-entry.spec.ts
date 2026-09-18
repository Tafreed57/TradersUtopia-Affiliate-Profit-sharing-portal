import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

// These UI tests intercept every auth write. No test accounts or upstream
// affiliate records are created, and no Google authentication is attempted.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/auth/providers", (route) => route.fulfill({ json: {
    google: { id: "google", name: "Google", type: "oauth", signinUrl: "/api/auth/signin/google", callbackUrl: "/api/auth/callback/google" },
    credentials: { id: "credentials", name: "credentials", type: "credentials", signinUrl: "/api/auth/signin/credentials", callbackUrl: "/api/auth/callback/credentials" },
  } }));
  await page.route("**/api/auth/csrf", (route) => route.fulfill({ json: { csrfToken: "ui-test-csrf" } }));
});

test("Work entry has its own brand, no earnings copy, and no currency requests", async ({ page }, testInfo) => {
  const unwantedRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(currency|students|commissions|dashboard|me\/backfill-status)/.test(request.url())) unwantedRequests.push(request.url());
  });
  await page.goto("/work");
  await expect(page).toHaveTitle("Traders Utopia Affiliate Work");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Traders UtopiaAffiliate Work");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(/commission|rewardful|fixed rate/i);
  await page.screenshot({ path: testInfo.outputPath("work-desktop.png"), fullPage: true, caret: "initial" });
  await page.getByRole("link", { name: "Create an account", exact: true }).click();
  await expect(page).toHaveURL(/\/work\/register$/, { timeout: 20_000 });
  await expect(page.getByLabel("Full name")).toBeVisible();
  expect(unwantedRequests).toEqual([]);
});

test("Work signup validates confirmation and preserves the Work classification in its request", async ({ page }) => {
  let registrationBody: Record<string, unknown> | undefined;
  await page.route("**/api/auth/register", async (route) => {
    registrationBody = route.request().postDataJSON();
    await route.fulfill({ status: 409, json: { error: "An account with this email already exists" } });
  });
  await page.goto("/work/register");
  await page.getByLabel("Full name").fill("Work UI Test");
  await page.getByLabel("Email", { exact: true }).fill("work-ui@example.com");
  await page.getByLabel("Password", { exact: true }).fill("work-password-123");
  await page.getByLabel("Confirm password", { exact: true }).fill("different-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Passwords do not match.");
  expect(registrationBody).toBeUndefined();
  await page.getByLabel("Confirm password", { exact: true }).fill("work-password-123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("An account with this email already exists");
  expect(registrationBody).toMatchObject({ accountType: "WORK", name: "Work UI Test", email: "work-ui@example.com" });
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/work");
});

for (const [path, onboardingType] of [["/work", "WORK"], ["/work/register", "WORK"], ["/login", "COMMISSION"], ["/register", "COMMISSION"]] as const) {
  test(`${path} explicitly scopes a Google sign-in attempt to ${onboardingType}`, async ({ page }) => {
    let parameters: URLSearchParams | undefined;
    await page.route("**/api/auth/signin/google", async (route) => {
      parameters = new URLSearchParams(route.request().postData() ?? "");
      await route.fulfill({ json: { url: `${path}?error=OAuthSignin` } });
    });
    await page.goto(path);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect.poll(() => parameters?.get("onboardingType")).toBe(onboardingType);
    expect(parameters?.get("callbackUrl")).toMatch(/^\/auth\/complete(?:\?|$)/);
  });
}

test("Work entry fits a narrow phone viewport and explains an expired sign-in", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/work?error=OnboardingExpired");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Sign-in could not be completed. Please try again.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Sign in", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("work-mobile.png"), fullPage: true, caret: "initial" });
});
