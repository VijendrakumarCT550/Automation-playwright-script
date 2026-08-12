class BasePage {
  constructor(page) {
    this.page = page;
  }

  async navigate(url) {
    await this.page.goto(url);
  }

  async getTitle() {
    return await this.page.title();
  }

  async waitForElement(selector, timeout = 30000) {
    await this.page.waitForSelector(selector, { timeout });
  }

  async click(selector) {
    await this.page.click(selector);
  }

  async fill(selector, value) {
    await this.page.fill(selector, value);
  }

  // React controlled inputs ignore standard fill() because React's synthetic
  // onChange never fires. This uses the native HTMLInputElement setter to
  // dispatch the events React actually listens for.
  async reactFill(locator, value) {
    await locator.waitFor({ state: 'visible' });
    await locator.click();
    await locator.evaluate((el, val) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }

  async getText(selector) {
    return await this.page.textContent(selector);
  }

  async isVisible(selector) {
    return await this.page.isVisible(selector);
  }

  async takeScreenshot(name) {
    await this.page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
  }

  // Ark UI Select structure (see RFICreatePage): the listbox positioner sits at
  // y=-100vh until Ark sets data-state="open", so we must wait for that state
  // rather than plain visibility before clicking an option.
  async openDropdown(trigger) {
    await trigger.waitFor({ state: 'visible' });
    await trigger.click();

    const listbox = this.page.locator('[role="listbox"][data-state="open"]');
    if (!(await listbox.isVisible({ timeout: 2000 }).catch(() => false))) {
      await trigger.press('Space');
    }
    await listbox.waitFor({ state: 'visible', timeout: 8000 });
    return listbox;
  }

  async selectDropdownOption(dropdown, optionText) {
    const listbox = await this.openDropdown(dropdown);
    const option = listbox.locator('[role="option"]').filter({ hasText: optionText }).first();
    await option.waitFor({ state: 'visible', timeout: 5000 });
    await option.click();
    await this.page.waitForTimeout(150);
  }

  async selectFirstDropdownOption(dropdown) {
    const listbox = await this.openDropdown(dropdown);
    const first = listbox.locator('[role="option"]').first();
    await first.waitFor({ state: 'visible', timeout: 5000 });
    await first.click();
    await this.page.waitForTimeout(150);
  }

  // Some fields' available options vary by deployment/data state (e.g. WAM's
  // Cluster field showing "Gujarat" on one load and "KHAVDA" on another for
  // the same underlying location) — try each candidate in order and select
  // whichever is actually present.
  async selectDropdownOptionAny(dropdown, candidates) {
    const listbox = await this.openDropdown(dropdown);
    for (const candidate of candidates) {
      const option = listbox.locator('[role="option"]').filter({ hasText: candidate }).first();
      if (await option.isVisible({ timeout: 1500 }).catch(() => false)) {
        await option.click();
        await this.page.waitForTimeout(150);
        return candidate;
      }
    }
    throw new Error(`None of the candidate options [${candidates.join(', ')}] were found in this dropdown`);
  }

  // Ark UI selects auto-close their listbox right after a pick when
  // single-select, but leave it open when multi-select (confirmed live on
  // the Add User dialog's Project Type/Work Locations fields) — that's the
  // only reliable signal for which behavior a given dropdown has, short of
  // reading its (not always present) aria-multiselectable attribute.
  //
  // `preferred` (optional) is a list of candidate substrings tried in
  // order — e.g. to pin specific Work Locations — before falling back to
  // whichever options are still unpicked, so a caller can require specific
  // values without needing to know in advance whether the field is
  // multi-select. Returns the option label texts actually picked, in the
  // order picked.
  async selectMultiAware(dropdown, { preferred = [], count = 1 } = {}) {
    const listbox = await this.openDropdown(dropdown);
    const picked = [];

    const clickOption = async (locator) => {
      if (!(await locator.isVisible({ timeout: 1500 }).catch(() => false))) return null;
      const label = (await locator.innerText()).trim();
      await locator.click();
      await this.page.waitForTimeout(150);
      return label;
    };

    for (const candidate of preferred) {
      if (picked.length >= count) break;
      const label = await clickOption(listbox.locator('[role="option"]').filter({ hasText: candidate }).first());
      if (label) picked.push(label);
    }

    if (picked.length === 0) {
      const label = await clickOption(listbox.locator('[role="option"]').first());
      if (label) picked.push(label);
    }

    const stillOpen = await listbox.isVisible({ timeout: 500 }).catch(() => false);
    if (stillOpen) {
      if (picked.length < count) {
        const options = listbox.locator('[role="option"]');
        const total = await options.count();
        for (let i = 0; i < total && picked.length < count; i++) {
          const opt = options.nth(i);
          // Skip already-picked options by data-state, NOT by comparing
          // text: once an option is checked, Ark UI's checkmark indicator
          // (hidden for unchecked options) becomes visible, so the SAME
          // option's innerText changes (e.g. "SOLAR" -> "SOLAR\n✓") —
          // confirmed live this made a naive text-based skip miss it and
          // click it again, which TOGGLES a multi-select option back off
          // instead of moving on, silently leaving a required field empty.
          const isChecked = await opt.getAttribute('data-state').catch(() => null) === 'checked'
            || await opt.getAttribute('aria-selected').catch(() => null) === 'true';
          if (isChecked) continue;
          const label = (await opt.innerText()).trim();
          await clickOption(opt);
          picked.push(label);
        }
      }
      // Multi-select popovers don't auto-close — close explicitly. Escape
      // is the PRIMARY mechanism (a keyboard event works even if some
      // unrelated element visually overlaps the trigger); re-clicking the
      // trigger is only a fallback. Confirmed live this matters: a
      // still-open multi-select popover's floating positioner can sit on
      // top of a LATER, unrelated field and silently intercept its clicks —
      // one such leak cascaded into 3 unrelated test failures downstream
      // before this existed (see UserManagementPage.js/goto()'s
      // closeAnyOpenListbox() call for the other half of this recovery).
      await this.page.keyboard.press('Escape').catch(() => {});
      const closed = await listbox.waitFor({ state: 'hidden', timeout: 3000 })
        .then(() => true).catch(() => false);
      if (!closed) {
        await dropdown.click().catch(() => {});
        await listbox.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      }
    }

    return picked;
  }

  // Recovery helper: if some earlier interaction left an Ark UI listbox
  // open (its close attempt silently failed, or the surrounding action
  // threw before reaching its own close step), the floating positioner can
  // sit on top of unrelated later controls and block every click in that
  // screen area until dismissed — confirmed live (see selectMultiAware).
  // Safe to call speculatively even when nothing is open (no-ops quickly).
  async closeAnyOpenListbox() {
    const openListbox = this.page.locator('[role="listbox"][data-state="open"]').first();
    if (await openListbox.isVisible({ timeout: 1000 }).catch(() => false)) {
      await this.page.keyboard.press('Escape').catch(() => {});
      await openListbox.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
  }

  // Same "leftover UI blocks later clicks" pattern as closeAnyOpenListbox
  // above, but for a toast notification — confirmed live for NC: a toast
  // left open after an earlier action (e.g. CI's resubmit) can sit on top
  // of completely unrelated later elements (the NC tab, even the "My
  // Tasks" nav link) and "intercept pointer events," blocking every click
  // there until it's gone — Playwright's own actionability log showed the
  // target element itself was visible/enabled/stable throughout, with the
  // toast (or in one case the whole <html>, once its backdrop had grown)
  // reported as the actual interceptor. Ark UI toasts auto-dismiss on
  // their own after a timeout, but that can be longer than the gap between
  // one TC's submit and the next TC's navigation attempt. Safe to call
  // speculatively even when nothing is open (no-ops quickly).
  async dismissToastIfPresent() {
    const toast = this.page.locator('[data-scope="toast"][data-state="open"]').first();
    if (await toast.isVisible({ timeout: 1000 }).catch(() => false)) {
      const closeButton = toast.locator('button').first();
      if (await closeButton.isVisible({ timeout: 500 }).catch(() => false)) {
        await closeButton.click().catch(() => {});
      } else {
        await this.page.keyboard.press('Escape').catch(() => {});
      }
      await toast.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  }

  // RFI/NC version badge ("v1"/"v2"/"v3") shown in the header only once a
  // specific record is open (not on list/dashboard pages) — same badge on
  // both the review page (EE/QI) and the create/resubmit page (CI).
  async getVersionBadge() {
    const badge = this.page.locator('text=/^v\\d+$/i').first();
    await badge.waitFor({ state: 'visible', timeout: 10000 });
    return (await badge.innerText()).trim();
  }

  // The record's UI-visible human-readable code (e.g.
  // "RFI-A-06c-BL01-CIV-528" / "NC-S-07b-300MW-BL02-CIV-22") — confirmed
  // live for RFI: it's the deepest breadcrumb crumb, alongside SEVERAL
  // other elements the app also marks aria-current="page" at shallower
  // breadcrumb levels ("My Tasks", "RFI"/"NC", "...Pending with
  // others/me") — an app rendering quirk, every ancestor crumb gets marked
  // current too, not just the deepest one.
  //
  // Matching by href EXACTLY EQUAL to the current page's path (not by
  // position via .first()/.last(), and not by a loose href substring) is
  // what actually works — confirmed live for RFI that BOTH .first() and
  // .last() are unreliable: the deepest crumb can mount asynchronously
  // slightly after the shallower ones, so a position-based pick can
  // resolve against a temporarily-last-but-not-final element while the DOM
  // is still settling. The current page's own path is unique and stable
  // the instant we're actually on it, sidestepping that race entirely.
  async getVisibleCode() {
    const path = new URL(this.page.url()).pathname;
    const crumb = this.page.locator(`a[aria-current="page"][href="${path}"]`);
    await crumb.waitFor({ state: 'visible', timeout: 10000 });
    return (await crumb.innerText()).trim();
  }
}

module.exports = { BasePage };
