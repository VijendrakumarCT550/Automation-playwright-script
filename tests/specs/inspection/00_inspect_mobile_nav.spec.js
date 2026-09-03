const { test, expect, devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { adminFreshLogin } = require('../../utils/helpers');

// Read-only. Follow-up to 00_inspect_wind_master_and_mobile.spec.js, which
// established that PULSE's mobile UI is the SAME responsive app at the same URL
// (identical role fingerprint, no user-agent sniffing) but that the desktop
// sidebar is gone: 8 visible nav links on desktop, ZERO on mobile, and none of
// DashboardPage's eight nav locators resolve. A screenshot showed the sidebar
// collapses behind a hamburger (three bars) next to the page title, and that
// button has NO accessible name — so it cannot be found by role+name.
//
// This spec's whole job is to produce the information needed to write
// MobileDashboardPage: identify the hamburger reliably, open it, and capture
// exactly what the nav becomes once open (element types, accessible names,
// whether they are links or buttons, and whether the panel is a dialog/drawer).
//
// Strategy: don't guess a selector. Enumerate every visible clickable element
// that has no text, dump enough about each to identify it, click the best
// candidate, and diff the page's nav-visible state before and after.
const OUT_DIR = path.join(__dirname, '..', '..', 'fixtures', 'mobile-recon');

// Same probe used on both viewports so the two are directly comparable.
const PROBE = () => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || '').trim().slice(0, 60),
      ariaLabel: el.getAttribute('aria-label'),
      ariaExpanded: el.getAttribute('aria-expanded'),
      ariaControls: el.getAttribute('aria-controls'),
      role: el.getAttribute('role'),
      id: el.id || null,
      dataAttrs: Object.fromEntries([...el.attributes]
        .filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value])),
      className: typeof el.className === 'string' ? el.className.slice(0, 120) : null,
      href: el.getAttribute('href'),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      svgCount: el.querySelectorAll('svg').length,
      // How many <line>/<path>/<rect> children the icon has — a hamburger is
      // classically three lines or a 3-line path.
      svgShapeCounts: [...el.querySelectorAll('svg')].map(s => ({
        line: s.querySelectorAll('line').length,
        path: s.querySelectorAll('path').length,
        rect: s.querySelectorAll('rect').length,
        viewBox: s.getAttribute('viewBox'),
      })),
      outerHTMLHead: el.outerHTML.slice(0, 300),
    };
  };

  const clickables = [...document.querySelectorAll('button, a, [role="button"], [role="link"]')]
    .filter(visible);

  // The first run of this spec found only TWO icon-only clickables on mobile,
  // both on the RIGHT (theme toggle x=312, notification bell x=352) — the
  // hamburger at x~20 was not among them. So it is NOT a button, link, or
  // role=button: it must be a plain element (div/span/svg) with a click
  // handler. Hence this second, tag-agnostic sweep: every visible SVG in the
  // viewport, with its ancestor chain, so the real clickable can be identified
  // by icon shape and position rather than by semantics it doesn't have.
  //
  // A hamburger icon is classically three horizontal lines: 3 <line>, or 3
  // <path>, or 3 <rect>, or a single path with 3 subpaths.
  const svgs = [...document.querySelectorAll('svg')].filter(visible).map((s) => {
    const r = s.getBoundingClientRect();
    const chain = [];
    let p = s.parentElement;
    for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
      const pr = p.getBoundingClientRect();
      chain.push({
        tag: p.tagName.toLowerCase(),
        role: p.getAttribute('role'),
        ariaLabel: p.getAttribute('aria-label'),
        className: typeof p.className === 'string' ? p.className.slice(0, 100) : null,
        onclick: !!p.onclick,
        cursor: getComputedStyle(p).cursor,
        rect: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) },
      });
    }
    return {
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      viewBox: s.getAttribute('viewBox'),
      shapes: {
        line: s.querySelectorAll('line').length,
        path: s.querySelectorAll('path').length,
        rect: s.querySelectorAll('rect').length,
        polyline: s.querySelectorAll('polyline').length,
      },
      classNameSvg: s.getAttribute('class'),
      cursor: getComputedStyle(s).cursor,
      ancestors: chain,
      outerHTMLHead: s.outerHTML.slice(0, 260),
    };
  });

  return {
    url: location.href,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    navLinkTexts: [...document.querySelectorAll('a')].filter(visible)
      .map(a => (a.innerText || '').trim()).filter(Boolean),
    iconOnlyClickables: clickables.filter(el => !(el.innerText || '').trim()).map(describe),
    textClickables: clickables.filter(el => (el.innerText || '').trim())
      .map(el => ({ tag: el.tagName.toLowerCase(), text: (el.innerText || '').trim().slice(0, 40) })),
    visibleSvgs: svgs,
    dialogCount: document.querySelectorAll('[role="dialog"]').length,
    navRoleCount: document.querySelectorAll('[role="navigation"], nav').length,
  };
};

// Second test, added after the first one succeeded. The mobile nav items turned
// out to be `<a href="/dashboard" role="treeitem">`, which raises a much better
// possibility than a parallel mobile page-object tree: if the DESKTOP sidebar
// uses the same treeitem role, then ONE viewport-aware nav method covers both
// layouts — "open the drawer first if it's collapsed, then click the treeitem"
// — and DashboardPage needs an addition rather than a mobile twin.
//
// This measures that directly on both viewports instead of assuming it.
test('Do desktop and mobile share the same nav roles?', async ({ browser }) => {
  test.setTimeout(900_000);

  const probeNav = async (page) => page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const items = [...document.querySelectorAll('[role="treeitem"]')];
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      treeitemTotal: items.length,
      treeitemVisible: items.filter(vis).length,
      treeitems: items.map(el => ({
        text: (el.innerText || '').trim(),
        tag: el.tagName.toLowerCase(),
        href: el.getAttribute('href'),
        visible: vis(el),
      })),
      // The trigger's own class hooks, so the locator can be verified per viewport.
      drawerTriggerCount: document.querySelectorAll('.drawer__trigger').length,
      lucideMenuCount: document.querySelectorAll('.lucide-menu').length,
      openDialogs: document.querySelectorAll('[data-scope="dialog"][data-state="open"]').length,
    };
  });

  const out = {};

  const desktop = await adminFreshLogin(browser);
  try {
    out.desktop = await probeNav(desktop.page);
  } finally {
    await desktop.context.close();
  }

  const { defaultBrowserType, ...device } = devices['Pixel 7'];
  const mobile = await adminFreshLogin(browser, { ...device });
  try {
    out.mobileClosed = await probeNav(mobile.page);

    // Open the drawer using the CLASS-BASED locator this recon discovered,
    // rather than the geometry the first test needed — this is the check that
    // the durable selector actually works.
    const trigger = mobile.page.locator('svg.drawer__trigger').first();
    await trigger.waitFor({ state: 'visible', timeout: 15000 });
    await trigger.click();
    await mobile.page.locator('[data-scope="dialog"][data-state="open"]')
      .first().waitFor({ state: 'visible', timeout: 10000 });
    await mobile.page.waitForTimeout(800);

    out.mobileOpen = await probeNav(mobile.page);
  } finally {
    await mobile.context.close();
  }

  for (const [label, d] of Object.entries(out)) {
    console.log(`\n=== ${label} (viewport ${JSON.stringify(d.viewport)}) ===`);
    console.log(`  treeitems: ${d.treeitemVisible} visible / ${d.treeitemTotal} total`);
    console.log(`  .drawer__trigger: ${d.drawerTriggerCount}, .lucide-menu: ${d.lucideMenuCount}, open dialogs: ${d.openDialogs}`);
    console.log(`  items: ${JSON.stringify(d.treeitems.map(t => `${t.text}${t.visible ? '' : ' (hidden)'}`))}`);
  }

  console.log('\n  ================ VERDICT ================');
  console.log(`  desktop uses role=treeitem for nav?  ${out.desktop.treeitemVisible > 0}`);
  console.log(`  mobile exposes them only when open?  closed=${out.mobileClosed.treeitemVisible} open=${out.mobileOpen.treeitemVisible}`);
  console.log(`  class-based trigger locator worked?  ${out.mobileOpen.treeitemVisible > out.mobileClosed.treeitemVisible}`);
  const shared = out.desktop.treeitems.filter(t => t.visible).map(t => t.text).sort();
  const mob = out.mobileOpen.treeitems.filter(t => t.visible).map(t => t.text).sort();
  console.log(`  desktop items: ${JSON.stringify(shared)}`);
  console.log(`  mobile items:  ${JSON.stringify(mob)}`);
  console.log(`  IDENTICAL SET? ${JSON.stringify(shared) === JSON.stringify(mob)}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dst = path.join(OUT_DIR, 'nav-roles-both-viewports.json');
  fs.writeFileSync(dst, JSON.stringify(out, null, 2));
  console.log(`\n  [saved] ${path.relative(path.join(__dirname, '..', '..', '..'), dst)}`);
});

// Verification of the DashboardPage change this recon motivated: navItem /
// revealNavIfCollapsed / navigateTo must work UNCHANGED on desktop and work AT
// ALL on mobile. Uses WAM rather than My Tasks so it doesn't depend on the
// logged-in role having RFI content.
test('navigateTo works on desktop and mobile without branching', async ({ browser }) => {
  test.setTimeout(900_000);
  const DashboardPage = require('../../pages/DashboardPage');

  const check = async (label, contextOptions) => {
    const { context, page } = await adminFreshLogin(browser, contextOptions);
    try {
      const dash = new DashboardPage(page);

      // Order matters here, and getting it wrong cost a run: the legacy
      // sidebar locator must be sampled BEFORE the drawer is opened. Once the
      // mobile drawer IS open, the nav links are in the DOM and visible, so
      // `navMyTasks` resolves on mobile too — which is a useful fact (it means
      // the legacy locators aren't mobile-hostile, they just need the drawer)
      // but makes it useless as a desktop-vs-mobile discriminator if sampled
      // afterwards.
      const navVisibleBefore = await dash.navItem('Dashboard').isVisible().catch(() => false);
      const desktopLocatorWorks = await dash.navMyTasks.isVisible().catch(() => false);

      const opened = await dash.revealNavIfCollapsed();
      const navVisibleAfter = await dash.navItem('Dashboard').isVisible().catch(() => false);
      const legacyLocatorAfterOpen = await dash.navMyTasks.isVisible().catch(() => false);

      await dash.navigateTo('WAM');
      await page.waitForTimeout(1500);
      const url = page.url();
      const arrivedAtWam = /wam/i.test(url);

      console.log(`\n=== ${label} ===`);
      console.log(`  nav items visible BEFORE revealNavIfCollapsed:  ${navVisibleBefore}`);
      console.log(`  legacy navMyTasks resolves BEFORE:              ${desktopLocatorWorks}`);
      console.log(`  revealNavIfCollapsed opened a drawer:           ${opened}`);
      console.log(`  nav items visible AFTER:                        ${navVisibleAfter}`);
      console.log(`  legacy navMyTasks resolves AFTER drawer open:   ${legacyLocatorAfterOpen}`);
      console.log(`  navigateTo('WAM') landed on:                    ${url}`);
      console.log(`  arrived at WAM:                                 ${arrivedAtWam}`);

      expect(navVisibleAfter, `${label}: nav items must be reachable after revealNavIfCollapsed`).toBe(true);
      expect(arrivedAtWam, `${label}: navigateTo('WAM') should navigate to the WAM page (got ${url})`).toBe(true);

      return { navVisibleBefore, opened, navVisibleAfter, desktopLocatorWorks, legacyLocatorAfterOpen, url };
    } finally {
      await context.close();
    }
  };

  const desktopResult = await check('desktop 1280x720', undefined);

  const { defaultBrowserType, ...device } = devices['Pixel 7'];
  const mobileResult = await check('mobile 412x839 (Pixel 7)', { ...device });

  console.log('\n  ================ VERDICT ================');
  console.log(`  desktop: no drawer needed (opened=${desktopResult.opened}), ` +
    `legacy locator resolves up front (${desktopResult.desktopLocatorWorks}) -> unchanged behaviour`);
  console.log(`  mobile:  drawer needed (opened=${mobileResult.opened}), ` +
    `legacy locator absent up front (${mobileResult.desktopLocatorWorks}), ` +
    `present once open (${mobileResult.legacyLocatorAfterOpen})`);

  // The whole point: desktop must NOT have needed the drawer and must take the
  // legacy path; mobile MUST have needed it and must not have had the legacy
  // path available to take.
  expect(desktopResult.opened, 'desktop should not need to open a drawer').toBe(false);
  expect(desktopResult.desktopLocatorWorks, 'desktop legacy sidebar locator should resolve up front').toBe(true);
  expect(mobileResult.opened, 'mobile should have had to open the drawer').toBe(true);
  expect(
    mobileResult.desktopLocatorWorks,
    'mobile should NOT resolve the legacy sidebar locator BEFORE the drawer is opened'
  ).toBe(false);
});

test('Mobile nav - find the hamburger and capture what it opens', async ({ browser }) => {
  test.setTimeout(900_000);

  const { defaultBrowserType, ...device } = devices['Pixel 7'];
  const { context, page } = await adminFreshLogin(browser, { ...device });
  const report = { baseUrl: process.env.BASE_URL, device: device.viewport };

  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    // ---- BEFORE ----
    report.before = await page.evaluate(PROBE);
    console.log(`\n=== MOBILE, nav CLOSED (viewport ${JSON.stringify(report.before.viewport)}) ===`);
    console.log(`  visible <a> texts: ${JSON.stringify(report.before.navLinkTexts)}`);
    console.log(`  nav/[role=navigation] elements: ${report.before.navRoleCount}`);
    console.log(`  icon-only clickables: ${report.before.iconOnlyClickables.length}`);
    for (const [i, c] of report.before.iconOnlyClickables.entries()) {
      console.log(`    [${i}] <${c.tag}> aria-label=${JSON.stringify(c.ariaLabel)} ` +
        `rect=${JSON.stringify(c.rect)} svgShapes=${JSON.stringify(c.svgShapeCounts)}`);
      console.log(`         class=${JSON.stringify(c.className)}`);
      console.log(`         html=${JSON.stringify(c.outerHTMLHead)}`);
    }
    await page.screenshot({ path: path.join(OUT_DIR, 'mobile-nav-closed.png'), fullPage: false });

    // ---- Dump every visible SVG so the hamburger can be identified ----
    console.log(`\n  visible SVGs: ${report.before.visibleSvgs.length}`);
    for (const [i, s] of report.before.visibleSvgs.entries()) {
      console.log(`    svg[${i}] rect=${JSON.stringify(s.rect)} shapes=${JSON.stringify(s.shapes)} ` +
        `cursor=${s.cursor} class=${JSON.stringify(s.classNameSvg)}`);
      console.log(`            ancestors=${JSON.stringify(s.ancestors.map(a =>
        `${a.tag}${a.role ? '[' + a.role + ']' : ''}${a.ariaLabel ? '(' + a.ariaLabel + ')' : ''}` +
        ` cur=${a.cursor} x=${a.rect.x}`))}`);
      console.log(`            html=${JSON.stringify(s.outerHTMLHead)}`);
    }

    // ---- Pick the hamburger candidate ----
    // The hamburger sits at the far LEFT of the header, left of the page title,
    // while the theme toggle and notification bell are on the right. It is not
    // a button/link (first run proved that), so rank the SVG sweep instead:
    // top region, smallest x, and preferably a three-bar icon.
    const svgCandidates = report.before.visibleSvgs
      .map((s, index) => ({ ...s, index }))
      .filter(s => s.rect.y < report.before.viewport.h * 0.30
        && s.rect.x < report.before.viewport.w * 0.35)
      .sort((a, b) => a.rect.x - b.rect.x);

    console.log(`\n  top-LEFT svg candidates (left to right): ` + JSON.stringify(
      svgCandidates.map(s => ({ i: s.index, x: s.rect.x, y: s.rect.y, shapes: s.shapes }))));
    expect(
      svgCandidates.length,
      'Expected at least one SVG in the top-left of the mobile view (the hamburger)'
    ).toBeGreaterThan(0);

    const pick = svgCandidates[0];
    // The clickable is usually an ancestor of the icon, not the icon itself —
    // prefer the nearest ancestor with cursor:pointer, else the icon.
    const clickableAncestor = pick.ancestors.find(a => a.cursor === 'pointer');
    report.hamburgerCandidate = pick;
    report.hamburgerClickTarget = clickableAncestor || { note: 'no pointer-cursor ancestor; clicked the svg itself' };

    const target = clickableAncestor ? clickableAncestor.rect : pick.rect;
    console.log(`\n  >>> clicking svg[${pick.index}] via ` +
      `${clickableAncestor ? `ancestor <${clickableAncestor.tag}> (cursor:pointer)` : 'the svg itself'} ` +
      `at ${JSON.stringify(target)}\n`);

    // Position-based click is only for THIS recon; the point of the exercise is
    // to discover a durable selector, reported at the end.
    await page.mouse.click(target.x + target.w / 2, target.y + target.h / 2);
    await page.waitForTimeout(1500);

    // ---- AFTER ----
    report.after = await page.evaluate(PROBE);
    console.log(`=== MOBILE, after clicking the candidate ===`);
    console.log(`  visible <a> texts: ${JSON.stringify(report.after.navLinkTexts)}`);
    console.log(`  nav/[role=navigation] elements: ${report.after.navRoleCount}`);
    console.log(`  [role=dialog] count: ${report.after.dialogCount}`);
    console.log(`  text clickables now visible: ` +
      JSON.stringify(report.after.textClickables.map(c => c.text)));
    await page.screenshot({ path: path.join(OUT_DIR, 'mobile-nav-open.png'), fullPage: false });

    const gained = report.after.navLinkTexts.filter(t => !report.before.navLinkTexts.includes(t));
    report.navItemsRevealed = gained;
    console.log(`\n  >>> nav items revealed by the click (${gained.length}): ${JSON.stringify(gained)}`);

    // What the revealed nav items actually ARE — needed to write locators.
    if (gained.length > 0) {
      report.revealedItemDetails = await page.evaluate((texts) => {
        const out = [];
        for (const t of texts) {
          const el = [...document.querySelectorAll('a, button, [role="link"], [role="button"]')]
            .find(e => (e.innerText || '').trim() === t);
          if (!el) continue;
          out.push({
            text: t,
            tag: el.tagName.toLowerCase(),
            href: el.getAttribute('href'),
            role: el.getAttribute('role'),
            className: typeof el.className === 'string' ? el.className.slice(0, 120) : null,
            // Is it inside a drawer/dialog/nav container?
            ancestors: (() => {
              const chain = [];
              let p = el.parentElement;
              for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
                chain.push({
                  tag: p.tagName.toLowerCase(),
                  role: p.getAttribute('role'),
                  dataState: p.getAttribute('data-state'),
                  dataScope: p.getAttribute('data-scope'),
                });
              }
              return chain;
            })(),
          });
        }
        return out;
      }, gained);

      console.log('\n  revealed item details:');
      for (const d of report.revealedItemDetails) {
        console.log(`    "${d.text}" <${d.tag}> href=${JSON.stringify(d.href)} ` +
          `role=${JSON.stringify(d.role)}`);
        console.log(`        ancestors: ${JSON.stringify(d.ancestors)}`);
      }
    }

    // ---- Recommend a durable selector ----
    console.log('\n  ================ FOR MobileDashboardPage ================');
    const h = report.hamburgerCandidate;
    console.log(`  hamburger icon: rect=${JSON.stringify(h.rect)} shapes=${JSON.stringify(h.shapes)}`);
    console.log(`                  svg class=${JSON.stringify(h.classNameSvg)}`);
    console.log(`                  html=${JSON.stringify(h.outerHTMLHead)}`);
    console.log(`  click target:   ${JSON.stringify(report.hamburgerClickTarget)}`);
    console.log(`  ancestor chain: ${JSON.stringify(h.ancestors, null, 2)}`);
    console.log(`  nav opens as: dialog=${report.after.dialogCount > (report.before.dialogCount)} ` +
      `nav-elements ${report.before.navRoleCount} -> ${report.after.navRoleCount}`);
    console.log(`  nav items:  ${JSON.stringify(report.navItemsRevealed)}`);
  } finally {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const dst = path.join(OUT_DIR, 'mobile-nav.json');
    fs.writeFileSync(dst, JSON.stringify(report, null, 2));
    console.log(`\n  [saved] ${path.relative(path.join(__dirname, '..', '..', '..'), dst)}`);
    await context.close();
  }
});
