import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// A document source is two shell commands, so a plain file stands in for a real service here.
const TMP = path.resolve(__dirname, ".tmp");
const HOME = path.join(TMP, "home");
// Each test gets its own document, as the server keeps documents it has opened.
let REMOTE = "", DOC = "", DRAFT = "";

test.beforeEach(({}, info) => {
  REMOTE = path.join(TMP, `doc-remote-${info.testId}.md`);
  const url = `file://${REMOTE}`;
  const key = createHash("sha256").update(url).digest("hex").slice(0, 12);
  DOC = `/~doc/fake/doc/${key}`;
  DRAFT = path.join(HOME, "docs", key, "document.md");
  fs.rmSync(path.join(HOME, "docs", key), { recursive: true, force: true });
  fs.mkdirSync(path.join(HOME, "docs"), { recursive: true });
  fs.writeFileSync(path.join(HOME, "doc-sources.json"), JSON.stringify({
    sources: [{ id: "fake", label: "Fake", match: "^file://(.+)$", fetch: "cat {id}", publish: "cp {file} {id}" }],
  }));
  fs.writeFileSync(path.join(HOME, "docs", `${key}.json`), JSON.stringify({ url, title: "Fake plan", sourceId: "fake" }));
  fs.writeFileSync(REMOTE, "# Fake plan\n\nFirst line.\n");
});

test("a document opens like a PR, and its draft publishes back to the source", async ({ page }) => {
  await page.goto(DOC);
  await expect(page.getByText("Fake plan").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "In Fake", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rendered" }).click();
  await expect(page.getByRole("heading", { name: "Fake plan" })).toBeVisible();

  // An edit (from the editor or Claude) is a draft until it is published.
  fs.writeFileSync(DRAFT, "# Fake plan\n\nFirst line.\nAdded in review.\n");
  await expect(page.getByRole("button", { name: "Draft (1)" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Publish to Fake", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published to Fake")).toBeVisible();
  expect(fs.readFileSync(REMOTE, "utf8")).toBe("# Fake plan\n\nFirst line.\nAdded in review.\n");
  await expect(page.getByRole("button", { name: "Draft (0)" })).toBeVisible();
});

test("publishing stops when the document changed at the source, and keeps the draft", async ({ page }) => {
  await page.goto(DOC);
  await expect(page.getByRole("button", { name: "In Fake", exact: true })).toBeVisible({ timeout: 30_000 });
  fs.writeFileSync(DRAFT, "# Fake plan\n\nMy edit.\n");
  await expect(page.getByRole("button", { name: "Draft (1)" })).toBeVisible({ timeout: 15_000 });
  fs.writeFileSync(REMOTE, "# Fake plan\n\nSomeone else's edit.\n");
  await page.getByRole("button", { name: "Publish to Fake", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("changed in Fake since you opened it");
  expect(fs.readFileSync(REMOTE, "utf8")).toBe("# Fake plan\n\nSomeone else's edit.\n");
  expect(fs.readFileSync(DRAFT, "utf8")).toBe("# Fake plan\n\nMy edit.\n");
});
