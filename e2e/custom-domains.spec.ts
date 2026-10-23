/**
 * Dashboard + API flow against the real app, database, Redis and public DNS.
 * Run headed: npm run test:e2e:headed
 *
 * Uses random labels under example.net (RFC 2606: real public DNS, no records
 * for them), so verification must fail with real per-record results, and
 * removal of a never-verified domain is direct. Each test gets its own owner.
 */
import { test, expect, type Page } from "@playwright/test";
import { createOwner, deleteOwner, disconnect, resetRateLimits, type TestOwner } from "./helpers";

let owner: TestOwner;
let other: TestOwner;
const host = `ncd-e2e-${Date.now()}.example.net`;

test.beforeEach(async () => {
  await resetRateLimits();
  owner = await createOwner("E2E Store", 2);
  other = await createOwner("E2E Other");
});

test.afterEach(async () => {
  await deleteOwner(owner.id);
  await deleteOwner(other.id);
});

test.afterAll(async () => {
  await disconnect();
});

async function signIn(page: Page, key: string) {
  await page.goto("/");
  await expect(page.locator("#cd_signin_card")).toBeVisible();
  await page.fill("#cd_signin_key", key);
  await page.click("#cd_signin_submit");
  await expect(page.locator("#cd_panel")).toBeVisible();
}

test.describe("sign in", () => {
  test("rejects an invalid key with the server's message", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#cd_signin_submit")).toBeDisabled();
    await page.fill("#cd_signin_key", "ncd_invalidinvalidinvalidinvalidinvalidinval");
    await page.click("#cd_signin_submit");
    await expect(page.locator("#cd_signin_error")).toContainText("not valid");
  });

  test("signs in and out", async ({ page }) => {
    await signIn(page, owner.apiKey);
    await expect(page.locator("#cd_add_card_title")).toHaveText("Connect your own domain");
    await page.click("#cd_signout");
    await expect(page.locator("#cd_signin_card")).toBeVisible();
  });
});

test.describe("domain lifecycle", () => {
  test("add, inspect records, test DNS, verify fails with real results, remove", async ({ page }) => {
    await signIn(page, owner.apiKey);

    // Server-side validation messages are shown inline.
    await page.fill("#cd_add_hostname", "192.0.2.10");
    await page.click("#cd_add_submit");
    await expect(page.locator("#cd_add_error")).toContainText("not an IP address");

    await page.fill("#cd_add_hostname", "shop.local");
    await page.click("#cd_add_submit");
    await expect(page.locator("#cd_add_error")).toContainText("Reserved or internal");

    const platform = process.env.NCD_PLATFORM_DOMAINS!.split(",")[0];
    await page.fill("#cd_add_hostname", `app.${platform}`);
    await page.click("#cd_add_submit");
    await expect(page.locator("#cd_add_error")).toContainText("cannot be used as a custom domain");

    // Toggle Auto SSL off and back on (keeps the default for the add below).
    const toggle = page.locator("#cd_add_autossl");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await page.fill("#cd_add_hostname", `https://${host.toUpperCase()}/path`);
    await page.click("#cd_add_submit");
    const card = page.locator('[data-card="domain-card"]').filter({ hasText: host });
    await expect(card).toBeVisible();
    const id = (await card.getAttribute("id"))!.replace("cd_card_", "");

    await expect(page.locator(`#cd_status_${id}`)).toHaveText("Waiting for DNS");
    await expect(page.locator(`#cd_record_cname_${id}_value`)).toHaveText(process.env.NCD_CNAME_TARGET!);
    await expect(page.locator(`#cd_record_txt_${id}_value`)).toHaveText(/^verify=[a-z2-7]{32}$/);
    await expect(card).not.toContainText(/\b\d{1,3}(\.\d{1,3}){3}\b/);

    await page.click(`#cd_test_dns_${id}`);
    await expect(page.locator(`#cd_record_cname_${id}_status`)).toHaveText("Not found", { timeout: 30_000 });
    await expect(page.locator(`#cd_record_txt_${id}_status`)).toHaveText("Not found");
    await expect(page.locator(`#cd_checked_at_${id}`)).toContainText("1.1.1.1");

    await page.click(`#cd_verify_${id}`);
    await expect(page.locator(`#cd_error_${id}`)).toContainText("No CNAME found", { timeout: 30_000 });
    await expect(page.locator(`#cd_status_${id}`)).toHaveText("Waiting for DNS");

    // Remove: cancel first, then confirm.
    await page.click(`#cd_remove_${id}`);
    await expect(page.locator("#cd_remove_dialog")).toBeVisible();
    await page.click("#cd_remove_dialog_cancel");
    await expect(page.locator("#cd_remove_dialog")).toBeHidden();
    await page.click(`#cd_remove_${id}`);
    await page.click("#cd_remove_dialog_confirm");
    await expect(card).toHaveCount(0);
    await expect(page.locator('[id^="ui_toast_"][id$="_text"]').last()).toContainText("removed");
  });

  test("enforces the per-owner domain limit", async ({ page }) => {
    await signIn(page, owner.apiKey);
    for (const n of [1, 2]) {
      await page.fill("#cd_add_hostname", `ncd-limit-${n}-${Date.now()}.example.net`);
      await page.click("#cd_add_submit");
      await expect(page.locator('[data-card="domain-card"]')).toHaveCount(n);
    }
    await page.fill("#cd_add_hostname", `ncd-limit-3-${Date.now()}.example.net`);
    await page.click("#cd_add_submit");
    await expect(page.locator("#cd_add_error")).toContainText("allows 2 custom domains");
  });
});

test.describe("API isolation", () => {
  test("requires auth, scopes by owner and rejects cross-origin cookie writes", async ({ request, page }) => {
    expect((await request.get("/api/v1/custom-domains")).status()).toBe(401);

    const created = await request.post("/api/v1/custom-domains", {
      headers: { authorization: `Bearer ${other.apiKey}` }, data: { hostname: `ncd-iso-${Date.now()}.example.net` },
    });
    expect(created.status()).toBe(201);
    const { data } = (await created.json()) as { data: { id: string } };

    const foreign = await request.get(`/api/v1/custom-domains/${data.id}`, { headers: { authorization: `Bearer ${owner.apiKey}` } });
    expect(foreign.status()).toBe(404);

    await signIn(page, owner.apiKey);
    const csrf = await page.request.post("/api/v1/custom-domains", {
      headers: { origin: "https://evil.example" }, data: { hostname: `ncd-csrf-${Date.now()}.example.net` },
    });
    expect(csrf.status()).toBe(403);
  });

  test("a tenant host only reaches allow-listed paths", async ({ request }) => {
    const headers = { host: "shop.unknown-tenant.com" };
    expect((await request.get("/api/v1/custom-domains", { headers })).status()).toBe(404);
    expect((await request.get("/api/session", { headers })).status()).toBe(404);
    // Allowed path, but the host belongs to nobody: the page itself answers 404.
    expect((await request.get("/", { headers })).status()).toBe(404);
    expect((await request.get("/api/health", { headers })).status()).toBe(200);
  });
});
