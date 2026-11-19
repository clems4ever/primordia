import { test, expect } from '@playwright/test';

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
  await expect(page.locator('.tools button[data-tool="meteor"]')).toHaveClass(/on/);
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
