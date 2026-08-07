const { BasePage } = require('./BasePage');

class LoginPage extends BasePage {
  constructor(page) {
    super(page);
    this.emailInput    = page.locator('input[placeholder="contractor@domain.com"]');
    this.passwordInput = page.locator('input[type="password"]');
    this.loginButton   = page.locator('button[type="submit"]');
  }

  async goto() {
    await this.navigate(process.env.BASE_URL);
    await this.page.waitForLoadState('networkidle');
  }

  // Ark UI inputs need real keyboard events. Triple-click selects existing content
  // cleanly (no Backspace/Control+A that could leave stray spaces), then
  // pressSequentially types character-by-character to trigger Zag.js state machine.
  async typeInField(locator, value) {
    await locator.waitFor({ state: 'visible' });
    // Triple-click selects all existing text so the next keypress replaces it
    await locator.click({ clickCount: 3 });
    await locator.pressSequentially(value, { delay: 40 });
  }

  async login(email, password) {
    await this.typeInField(this.emailInput, email);
    // Tab triggers the email field's blur/validation and moves focus to password
    await this.page.keyboard.press('Tab');

    await this.typeInField(this.passwordInput, password);
    // Tab away from password triggers its blur/validation
    await this.page.keyboard.press('Tab');

    // Wait for the submit button to become enabled after both fields validate
    await this.page.waitForFunction(
      () => {
        const btn = document.querySelector('button[type="submit"]');
        return btn && !btn.disabled;
      },
      { timeout: 10000 }
    ).catch(() => {
      // Still disabled — fall through to force-click as user confirmed works manually
    });

    const isDisabled = await this.loginButton.isDisabled();
    if (isDisabled) {
      await this.loginButton.dblclick({ force: true });
    } else {
      await this.loginButton.click();
    }

    // Login takes 1–2 minutes in this environment — wait up to 3 minutes.
    // Playwright passes a URL *object* to the predicate, not a string,
    // so use .href to get the string representation.
    await this.page.waitForURL(
      url => !url.href.includes('/login'),
      { timeout: 200000 }
    ).catch(async () => {
      const errorText = await this.page
        .locator('[data-scope="toast"], [role="alert"], [class*="error"]')
        .first()
        .textContent()
        .catch(() => 'no error captured');
      throw new Error(`Login failed - still on login page. App message: ${errorText}`);
    });

    // Wait for the React SPA to fully render the post-login page content
    await this.page.waitForLoadState('networkidle');
  }
}

module.exports = LoginPage;
