import { test, expect, devices } from '@playwright/test';

// Fail any test that logs a page error or a console error.
test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.errors = errors;
});
test.afterEach(async ({ page }) => {
  expect(page.errors, 'no page or console errors').toEqual([]);
});

const world = (page, fn, arg) => page.evaluate(fn, arg);

test('the world loads and evolves', async ({ page }) => {
  await page.goto('/?seed=7');
  await expect(page.locator('h1')).toHaveText('Primordia');
  const t0 = await world(page, () => window.primordia.world.t);
  await page.waitForTimeout(1000);
  const t1 = await world(page, () => window.primordia.world.t);
  expect(t1).toBeGreaterThan(t0);
  await expect(page.locator('#s-pop')).not.toHaveText('0');
});

test('clicking a creature opens the inspector with its brain', async ({ page }) => {
  await page.goto('/?seed=7&warm=1500');
  await page.keyboard.press('Space');                     // pause so the target stays put
  const pt = await world(page, () => {
    const { world, toScreen } = window.primordia;
    const c = world.creatures.find((c) => c.g.diet > 0.5) ?? world.creatures[0];
    return toScreen(c.x, c.y);
  });
  await page.mouse.click(pt[0], pt[1]);
  await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
  await expect(page.locator('#i-name')).not.toHaveText('—');
  await expect(page.locator('#i-genes .gene')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector')).toHaveClass(/hidden/);
});

test('the spontaneous-generation switch drives the simulation', async ({ page }) => {
  await page.goto('/?seed=7');
  expect(await world(page, () => window.primordia.world.cfg.respawn)).toBe(false);
  await page.locator('label.switch').click();
  expect(await world(page, () => window.primordia.world.cfg.respawn)).toBe(true);
});

test('sliders change the world parameters', async ({ page }) => {
  await page.goto('/?seed=7');
  await page.locator('#r-food').fill('0');
  await expect(page.locator('#o-food')).toHaveText('famine');
  expect(await world(page, () => window.primordia.world.cfg.foodRate)).toBe(0);
  await page.locator('#r-mut').fill('2');
  expect(await world(page, () => window.primordia.world.cfg.mutation)).toBe(2);
});

test('a meteor strike is reported in the ticker', async ({ page }) => {
  await page.goto('/?seed=7');
  await page.keyboard.press('4');
  await expect(page.locator('.actions .tool[data-tool="meteor"]')).toHaveClass(/on/);
  await page.mouse.click(500, 450);
  await expect(page.locator('#ticker')).toContainText('A meteor struck');
});

test('P toggles the performance overlay', async ({ page }) => {
  await page.goto('/?seed=7');
  await expect(page.locator('#perf')).toBeHidden();
  await page.keyboard.press('p');
  await expect(page.locator('#perf')).toBeVisible();
  await expect(page.locator('#perf')).toContainText(/fps .* ticks\/s/);
  await page.keyboard.press('p');
  await expect(page.locator('#perf')).toBeHidden();
});

test('documentary mode frames a subject with a caption, and Esc leaves it', async ({ page }) => {
  await page.goto('/?seed=7&warm=2000');
  await page.keyboard.press('d');
  await expect(page.locator('body')).toHaveClass(/cinema/);
  await expect(page.locator('#caption')).toHaveClass(/show/, { timeout: 5000 });
  await expect(page.locator('#caption .ct')).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/cinema/);
});

test('the sound button switches sound on and off', async ({ page }) => {
  await page.goto('/?seed=7');
  await page.click('#b-sound');
  await expect(page.locator('#b-sound')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#b-sound');
  await expect(page.locator('#b-sound')).toHaveAttribute('aria-pressed', 'false');
});

test.describe('on a phone', () => {
  const { defaultBrowserType, ...pixel } = devices['Pixel 7'];
  test.use(pixel);

  test('fits the screen, with a collapsed sheet that expands', async ({ page }) => {
    await page.goto('/?seed=7');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.locator('#panel').boundingBox();
    const vp = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.height).toBeLessThan(vp.height * 0.25);
    await expect(page.locator('#c-pop')).toBeHidden();
    await page.locator('#sheet-handle').click();
    await expect(page.locator('#c-pop')).toBeVisible();
    await page.locator('#sheet-handle').click();
    await expect(page.locator('#c-pop')).toBeHidden();
  });

  test('tapping a creature opens the inspector', async ({ page }) => {
    await page.goto('/?seed=7&warm=1500');
    await page.locator('#b-pause').click();
    const pt = await page.evaluate(() => {
      const { world, toScreen } = window.primordia;
      const ok = ([x, y]) => x > 40 && x < innerWidth - 40 && y > 200 && y < innerHeight - 260;
      return toScreen(...['x', 'y'].map((k) => world.creatures.find((c) => ok(toScreen(c.x, c.y)))[k]));
    });
    await page.touchscreen.tap(pt[0], pt[1]);
    await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
  });

  test('pinching zooms the camera', async ({ page }) => {
    await page.goto('/?seed=7');
    const z0 = await page.evaluate(() => window.primordia.cam.z);
    const cv = await page.locator('#world').elementHandle();
    const touch = (type, id, x, y) => cv.dispatchEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, isPrimary: id === 1, bubbles: true });
    await touch('pointerdown', 1, 160, 400); await touch('pointerdown', 2, 240, 400);
    for (let i = 1; i <= 5; i++) { await touch('pointermove', 1, 160 - i * 15, 400); await touch('pointermove', 2, 240 + i * 15, 400); }
    await touch('pointerup', 1, 85, 400); await touch('pointerup', 2, 315, 400);
    const z1 = await page.evaluate(() => window.primordia.cam.z);
    expect(z1).toBeGreaterThan(z0 * 2);
  });
});
