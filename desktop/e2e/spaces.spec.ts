import { expect, test, type Page } from "@playwright/test";

/** Fail the test on any console error other than expected 4xx answers. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

async function addPr(page: Page, link: string) {
  await page.getByRole("button", { name: "Add a PR to this space" }).click();
  await page.getByLabel("PR link to add").fill(link);
  await page.getByRole("button", { name: "Add", exact: true }).click();
}

test.describe.configure({ mode: "serial" });

test("a space holds several PRs as tabs that keep their own state", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/reviews");
  await page.getByRole("button", { name: /^My reviews current/ }).click();
  await expect(page).toHaveURL(/\/space\//);
  await expect(tab(page, "fixture #1")).toBeVisible();

  // Tab 1: open util.py and select a line.
  await page.locator('button[title="src/util.py"]').click();
  await page.locator('[data-line="new-2"]').getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByText("Ask Claude about line 2")).toBeVisible();

  // Tab 2: a compare of the same repo.
  await addPr(page, "https://github.com/local/fixture/compare/v1...feature");
  const compare = tab(page, "fixture v1...feature");
  await expect(compare).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "local/fixture/compare/v1...feature" }).getByText("Changed 4")).toBeVisible();
  await expect(page).toHaveURL(/pr=local%2Ffixture%2Fcompare/);

  // Back to tab 1: same file and selection.
  await tab(page, "fixture #1").click();
  const pr = page.getByRole("tabpanel", { name: "local/fixture/pull/1" });
  await expect(pr.getByText("src/util.py").first()).toBeVisible();
  await expect(pr.getByText("Ask Claude about line 2")).toBeVisible();
  await expect(page).toHaveURL(/file=src%2Futil\.py/);
  expect(errors).toEqual([]);
});

test("a hidden tab shows Claude working, then a new-answer dot", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/reviews");
  await page.getByRole("button", { name: /^My reviews current/ }).click();
  await tab(page, "fixture #1").click();
  const pr = page.getByRole("tabpanel", { name: "local/fixture/pull/1" });
  await pr.getByRole("button", { name: "Questions about the whole change" }).click();
  await pr.getByPlaceholder("Ask about the whole change…").fill("Quick check from a tab, PAUSE");
  await pr.getByPlaceholder("Ask about the whole change…").press("Enter");
  await tab(page, "fixture v1...feature").click();
  await expect(page.getByLabel("Claude is answering")).toBeVisible();
  await expect(page.getByLabel("New answer")).toBeVisible();
  await tab(page, "fixture #1").click();
  await expect(page.getByLabel("New answer")).toHaveCount(0);
  await expect(pr.getByText("Quick check from a tab")).toBeVisible();
  expect(errors).toEqual([]);
});

test("spaces can be created, renamed, switched, and survive a reload", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/reviews");
  const before = await (await page.request.get("/api/spaces")).json();
  const newName = `Space ${before.spaces.length + 1}`;
  await page.getByRole("button", { name: "New space" }).click();
  await expect(page.getByText(`${newName} is empty`)).toBeVisible();
  await addPr(page, "https://github.com/local/fixture/tree/main");
  await expect(tab(page, "fixture : main")).toBeVisible();

  // Rename it.
  await page.getByRole("button", { name: "Switch space" }).click();
  await page.getByRole("button", { name: `Rename ${newName}` }).click();
  await page.getByLabel("Space name").fill("Branch reading");
  await page.getByLabel("Space name").press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Switch space" })).toContainText("Branch reading");

  // Switch back to the first space; its tabs are intact.
  await page.getByRole("button", { name: "Switch space" }).click();
  await page.getByRole("menuitem", { name: /My reviews/ }).click();
  await expect(tab(page, "fixture #1")).toBeVisible();
  await expect(tab(page, "fixture v1...feature")).toBeVisible();
  await expect(tab(page, "fixture : main")).toHaveCount(0);

  await page.reload();
  await expect(tab(page, "fixture #1")).toBeVisible();
  await page.goto("/reviews");
  await expect(page.getByRole("button", { name: /^Branch reading/ })).toContainText("fixture : main");

  // Each space has a colour and an emoji, and both can be changed.
  const look = page.getByRole("button", { name: "Change Branch reading's colour and emoji" });
  await look.click();
  await page.getByRole("button", { name: "🦖" }).click();
  await page.getByRole("button", { name: "teal" }).click();
  await expect(look).toHaveText("🦖");
  await expect(look).toHaveClass(/bg-teal/);
  await page.reload();
  await expect(look).toHaveText("🦖");
  await expect(look).toHaveClass(/bg-teal/);
  expect(errors).toEqual([]);
});

test("closing tabs and deleting a space", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/reviews");
  await page.getByRole("button", { name: /^My reviews current/ }).click();
  await page.getByRole("button", { name: "Close fixture v1...feature" }).click();
  await expect(tab(page, "fixture v1...feature")).toHaveCount(0);
  await expect(tab(page, "fixture #1")).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(tab(page, "fixture v1...feature")).toHaveCount(0);

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Switch space" }).click();
  await page.getByRole("button", { name: "Delete Branch reading" }).click();
  await page.goto("/reviews");
  await expect(page.getByRole("button", { name: /^Branch reading/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the standalone PR page can add itself to a space", async ({ page }) => {
  await page.goto("/local/fixture/compare/v1...feature");
  await page.getByRole("button", { name: "Add to space" }).click();
  await expect(page).toHaveURL(/\/space\//);
  await expect(tab(page, "fixture v1...feature")).toHaveAttribute("aria-selected", "true");
});

test("PRs on the home page open into any space, or a new one", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/reviews");
  const review = page.locator("section", { has: page.getByRole("heading", { name: "Waiting on your review" }) });
  const row = review.locator("div.group").first();
  const chips = row.locator("[data-space-chip]");
  await expect(chips.filter({hasText:"My reviews"})).toHaveCount(1);
  const initialChipCount = await chips.count();

  // The menu lists every space, marks where the PR is already open, and can make a new space.
  await row.getByRole("button", { name: "Open in another space" }).click();
  await expect(page.getByRole("menuitem", { name: /My reviews.*open/ })).toBeVisible();
  await page.getByRole("menuitem", { name: "New space with this PR" }).click();
  await expect(page).toHaveURL(/\/space\//);
  await expect(tab(page, "fixture #1")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Switch space" })).not.toContainText("My reviews");

  // Back home, the row knows it's in both spaces, and the quick button opens the current one.
  await page.goto("/reviews");
  await expect(chips).toHaveCount(initialChipCount + 1);
  await row.getByTitle(/Open its tab in/).first().click();
  await expect(tab(page, "fixture #1")).toHaveAttribute("aria-selected", "true");
  const spaceName = (await page.getByRole("button", { name: "Switch space" }).textContent())!.trim();

  // From an empty space, the quick button goes to a space the PR is already in, not the empty one.
  await page.goto("/reviews");
  await page.getByRole("button", { name: "New space", exact: true }).click();
  await expect(page).toHaveURL(/\/space\//);
  await expect(tab(page, "fixture #1")).toHaveCount(0);
  await page.goto("/reviews");
  const quick = row.getByTitle(/Open its tab in/).first();
  await expect(quick).toHaveText(/My reviews/);
  await quick.click();
  await expect(tab(page, "fixture #1")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Switch space" })).toContainText("My reviews");
  expect(spaceName).not.toContain("My reviews");
  expect(errors).toEqual([]);
});
