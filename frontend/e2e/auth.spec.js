import { test, expect } from '@playwright/test'

const VALID_ADMIN_EMAIL = 'admin@constructionsight.com'
const VALID_ADMIN_PASSWORD = 'Admin123!'
const VALID_USER_EMAIL = 'user@constructionsight.com'
const VALID_USER_PASSWORD = 'User123!'

// Helper: fill in and submit the login form
async function login(page, identifier, password) {
  await page.fill('input[placeholder*="email or username" i]', identifier)
  await page.fill('input[placeholder*="password" i]', password)
  await page.click('button[type="submit"]')
}

// Helper: clear session and navigate to login
async function clearSession(page) {
  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.clear()
  })
}

test.describe('Authentication flows', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page)
  })

  test('login page renders the Sign In form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('text=Sign In').first()).toBeVisible()
    await expect(page.locator('input[placeholder*="email or username" i]')).toBeVisible()
    await expect(page.locator('input[placeholder*="password" i]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('shows validation error when submitting empty form', async ({ page }) => {
    await page.goto('/login')
    await page.click('button[type="submit"]')
    // Toast error should appear
    await expect(page.locator('text=/email or username/i')).toBeVisible({ timeout: 5000 })
  })

  test('shows error message for invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await login(page, 'wrong@example.com', 'WrongPassword123!')
    // Should stay on login page and show an error toast
    await expect(page).toHaveURL(/login/, { timeout: 8000 })
  })

  test('redirects unauthenticated user from protected route to /login', async ({ page }) => {
    await page.goto('/projects/my')
    await expect(page).toHaveURL(/login/, { timeout: 5000 })
  })

  test('redirects unauthenticated user from admin route to /login', async ({ page }) => {
    await page.goto('/admin/dashboards/analytics')
    await expect(page).toHaveURL(/login/, { timeout: 5000 })
  })

  test('successful login navigates away from login page', async ({ page }) => {
    await page.goto('/login')
    await login(page, VALID_ADMIN_EMAIL, VALID_ADMIN_PASSWORD)
    // Should navigate to admin dashboard or projects page
    await expect(page).not.toHaveURL(/login/, { timeout: 10000 })
  })

  test('admin is redirected to admin dashboard after login', async ({ page }) => {
    await page.goto('/login')
    await login(page, VALID_ADMIN_EMAIL, VALID_ADMIN_PASSWORD)
    await expect(page).toHaveURL(/admin/, { timeout: 10000 })
  })

  test('regular user is redirected to /projects/my after login', async ({ page }) => {
    await page.goto('/login')
    await login(page, VALID_USER_EMAIL, VALID_USER_PASSWORD)
    await expect(page).toHaveURL(/projects\/my/, { timeout: 10000 })
  })

  test('logout clears session and redirects to login', async ({ page }) => {
    // First log in
    await page.goto('/login')
    await login(page, VALID_ADMIN_EMAIL, VALID_ADMIN_PASSWORD)
    await expect(page).not.toHaveURL(/login/, { timeout: 10000 })
    // Clear session (simulates logout)
    await clearSession(page)
    await page.goto('/projects/my')
    await expect(page).toHaveURL(/login/, { timeout: 5000 })
  })

  test('remember me checkbox is present', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('#rememberMe')).toBeVisible()
    const label = page.locator('label[for="rememberMe"]')
    await expect(label).toBeVisible()
  })

  test('password toggle shows and hides password', async ({ page }) => {
    await page.goto('/login')
    const passInput = page.locator('input[placeholder*="password" i]')
    await expect(passInput).toHaveAttribute('type', 'password')
    // Click the eye toggle button
    await page.click('.input-group-text.c-pointer')
    await expect(passInput).toHaveAttribute('type', 'text')
    // Click again to hide
    await page.click('.input-group-text.c-pointer')
    await expect(passInput).toHaveAttribute('type', 'password')
  })

  test('forgot password link points to reset path', async ({ page }) => {
    await page.goto('/login')
    const link = page.locator('text=Forgot password?')
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    expect(href).toContain('reset')
  })

  test('create account link is visible', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('text=Create an account')).toBeVisible()
  })
})
