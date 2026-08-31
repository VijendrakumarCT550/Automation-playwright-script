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
    // Confirmed live (single-session-login-fix-for-passes branch, NC's
    // Work Location dropdown): under concurrent-session load this can take
    // longer than 5000ms to render even though the listbox itself already
    // opened fine — same class of fix as RFICreatePage's own
    // _openDropdown timeout bump. Widened to 15000ms.
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click();
    await this.page.waitForTimeout(150);
  }

  async selectFirstDropdownOption(dropdown) {
    const listbox = await this.openDropdown(dropdown);
    const first = listbox.locator('[role="option"]').first();
    await first.waitFor({ state: 'visible', timeout: 15000 });
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
  // above, but for a modal DIALOG (Ark UI's `[data-scope="dialog"]` shape —
  // e.g. RFIReviewPage's "Are you sure you want to approve RFI?" confirm
  // popup). Confirmed live 2026-08-27 (RFI single-session flow, QI's final
  // approve turn): a confirm popup left open from an earlier
  // interrupted/retried attempt (withRetry re-runs a turn from scratch on
  // failure, starting again from the "My Tasks" nav click, WITHOUT
  // checking whether the previous attempt left a dialog open) sat on top
  // of the entire page and blocked even that nav click — Playwright's
  // actionability log reported `<html>...intercepts pointer events` as the
  // interceptor, i.e. the modal's backdrop, not the dialog content itself.
  // Same root shape as dismissToastIfPresent's toast case, just for a
  // dialog instead. Safe to call speculatively even when nothing is open.
  async closeAnyOpenDialog() {
    const openDialog = this.page.locator('[data-scope="dialog"][data-part="content"], [role="dialog"]').first();
    if (await openDialog.isVisible({ timeout: 1000 }).catch(() => false)) {
      await this.page.keyboard.press('Escape').catch(() => {});
      await openDialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
  }

  // Polls `check()` every `intervalMs`, capped at `timeoutMs` total, instead
  // of one single blocking wait/click with no explicit timeout — which
  // silently inherits playwright.config.js's global `actionTimeout`
  // (30000ms) underneath. Confirmed live: RFI's Work-Location-dependent
  // dropdowns (Work Area, Package, Activity, ...) can sit briefly
  // blocked/loading right after Work Location changes; a plain
  // trigger.click() + option.click() with no timeout, one after another,
  // each silently retrying against that 30s ceiling, is what made simple
  // Work Area selection feel like it was "waiting 30-60 seconds" even
  // though the real underlying wait needed was much shorter. Returns true
  // as soon as `check()` resolves truthy, false if the deadline passes
  // first — callers decide whether that's a real error.
  async pollUntil(check, { timeoutMs = 10000, intervalMs = 300 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check().catch(() => false)) return true;
      await this.page.waitForTimeout(intervalMs);
    }
    return false;
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

  // Camera capture widget: a dashed "Use Camera" box (camera icon + label —
  // NOT a native file input) shared across NC's create/response/review
  // screens (and referenced, still-unautomated, in RFIReviewPage's own
  // header comment) — a generic app-wide component, hence living here
  // rather than duplicated per NC page object. Confirmed live via
  // tests/specs/00_inspect_nc_capture_photo.spec.js: clicking it opens a
  // real getUserMedia <video> preview with "Capture"/"Cancel" buttons (no
  // native file picker involved — playwright.config.js grants the 'camera'
  // permission and launches Chromium with
  // --use-fake-device-for-media-stream so this works headlessly/on CI
  // runners with no real webcam). Clicking "Capture" snapshots the video
  // straight into an attached thumbnail <img> with no separate
  // confirm/retake step — the video element itself disappears once
  // captured, which is what this waits on to know the attach landed.
  // `container` scopes the "Use Camera" lookup for pages that could have
  // more than one such widget (defaults to the whole page).
  async capturePhoto(container = this.page) {
    const useCameraTrigger = container.getByText('Use Camera', { exact: false }).first();
    await useCameraTrigger.waitFor({ state: 'visible', timeout: 10000 });
    await useCameraTrigger.click({ force: true });

    const video = this.page.locator('video').first();
    await video.waitFor({ state: 'visible', timeout: 10000 });
    // Confirmed live: clicking Capture the instant the <video> becomes
    // visible can silently no-op (the fake stream hasn't started rendering
    // frames yet) — the camera modal (and its full-viewport backdrop) then
    // stays open and blocks every later click on the page, surfacing much
    // later as a confusing "element intercepts pointer events" failure on
    // whatever's clicked next (e.g. Submit), not here. A short settle wait
    // avoids that in the common case.
    await this.page.waitForTimeout(1000);

    const captureButton = this.page.getByRole('button', { name: 'Capture', exact: true }).first();
    await captureButton.waitFor({ state: 'visible', timeout: 5000 });
    await captureButton.click();

    // One retry if the first click still didn't register (same failure
    // class as above), then a HARD wait — no swallowed .catch() — so a
    // genuinely stuck camera modal throws right here with a clear cause,
    // instead of a mystifying failure downstream.
    const closed = await video.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true).catch(() => false);
    if (!closed) {
      await captureButton.click();
      await video.waitFor({ state: 'hidden', timeout: 10000 });
    }
    await this.page.waitForTimeout(300);
  }

  // "View Attachments" is the read-only gallery of photos captured by
  // EARLIER actors in the NC flow (e.g. QI's create-time photo, visible on
  // CI's response page; CI's response photo, visible on EE's review page).
  // Used to assert attachments actually propagate to the next responsible
  // person, not just that the capturing actor's own submit succeeded.
  // Scoped to the label's parent container (not a bare page-wide `img`
  // count) so it doesn't pick up unrelated chrome (header avatar, logo,
  // notification icon).
  async getAttachmentCount() {
    const label = this.page.getByText('View Attachments', { exact: false }).first();
    // NOT `label.isVisible({ timeout })` — confirmed live that isVisible()
    // does NOT poll despite accepting a timeout option; it's a single
    // immediate check. This label genuinely doesn't exist in the DOM yet
    // right when openFromPendingWithMe returns (a client-side SPA route
    // transition) — it renders in ~2s — so isVisible() at t=0 always read
    // false and this returned a false "0 attachments" even though the
    // photo was there and visible moments later. waitFor() is what
    // actually polls.
    const appeared = await label.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    if (!appeared) return 0;

    const container = label.locator('xpath=..');
    // Confirmed live: the attachment's blob-URL <img> can render a beat
    // after openRowByCode's networkidle wait already resolved (a
    // client-side SPA route transition, not a full page load) — a bare
    // one-shot count() read 0 even though the photo genuinely was there
    // and rendered correctly moments later. Poll briefly for the image
    // rather than counting once; a real "no attachment" case still
    // legitimately returns 0 after the timeout elapses.
    await container.locator('img').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    return await container.locator('img').count();
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
  // MOBILE has no breadcrumb at all — the header renders a back chevron plus the
  // code instead (confirmed live 2026-09-01: a wind RFI created at a phone
  // viewport submitted fine and then died here, because
  // `a[aria-current="page"]` simply does not exist). So fall back to reading the
  // code out of the page itself.
  //
  // Read via textContent, NOT innerText: on mobile the header code is visually
  // TRUNCATED with a CSS ellipsis ("RFI-WTG-Khavda-KH 52-CIV-30…"). CSS
  // truncation does not change textContent, so the full string is still there —
  // but innerText is rendering-aware and can give back the clipped form.
  async getVisibleCode() {
    const path = new URL(this.page.url()).pathname;
    const crumb = this.page.locator(`a[aria-current="page"][href="${path}"]`);

    const gotCrumb = await crumb.waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true).catch(() => false);
    if (gotCrumb) return (await crumb.innerText()).trim();

    const fromHeader = await this.page.evaluate(() => {
      // A record code looks like "RFI-<work location>-<work area>-<pkg>-<n>" or
      // "NC-...". Work locations contain hyphens and wind work areas contain a
      // SPACE, so the pattern has to allow both.
      const rx = /^(RFI|NC)-[A-Za-z0-9][A-Za-z0-9 ._/-]*\d$/;
      const seen = [];
      for (const el of document.querySelectorAll('h1,h2,h3,h4,p,span,div,a,button')) {
        if (el.children.length) continue;            // leaf nodes only
        const t = (el.textContent || '').trim();     // NOT innerText — see above
        if (t.length >= 10 && rx.test(t)) seen.push(t);
      }
      // Longest match wins: if any element does hold a clipped copy, the full
      // one is longer.
      seen.sort((a, b) => b.length - a.length);
      return seen[0] || null;
    });

    if (fromHeader) return fromHeader;

    throw new Error(
      `Could not read the record's visible code. No breadcrumb matched ` +
      `a[aria-current="page"][href="${path}"] (expected on mobile, which has no ` +
      `breadcrumb) and no element's textContent looked like an RFI/NC code either.`
    );
  }
}

module.exports = { BasePage };
