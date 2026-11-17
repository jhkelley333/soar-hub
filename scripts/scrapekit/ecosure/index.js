/**
 * scrapekit ecosure connector
 *
 * Usage (via scrapekit CLI):
 *   scrapekit ecosure login   — saves TrueView credentials to Keychain
 *   scrapekit ecosure check   — exports assessments + findings, pushes to Supabase
 *
 * INTEGRATION: Drop this file (and parser.js) into your scrapekit connectors/ecosure/
 * directory and register it in your CLI dispatcher the same way the RAP connector is
 * registered. The module exports { name, login, check } as a standard connector shape.
 *
 * Host allowlist (Playwright network interception):
 *   trueview.ecosure.com          — main portal
 *   api.trueview.ecosure.com      — login / API
 *   ecolabb2c.b2clogin.com        — Azure B2C tenant
 *   account.ecolab.com            — B2C policy endpoint
 *   analytics-bi.trueview.ecosure.com — Power BI embedded visuals
 *   analyticsdocs.trueview.ecosure.com — PDF report files
 *   + standard Microsoft auth CDN hosts (login.microsoftonline.com, aadcdn.msauth.net)
 *
 * Browser lock: shared with the RAP connector so the two don't collide.
 * Uses ~/.scrapekit/browser.lock — adjust LOCK_FILE to match your setup.
 */

"use strict";

const path          = require("path");
const os            = require("os");
const fs            = require("fs");
const { execFileSync } = require("child_process");
const { chromium }  = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const { parseAssessmentsXlsx, parseFindingsXlsx } = require("./parser");

// ─── Configuration ────────────────────────────────────────────────────────────

const PORTAL_URL  = "https://trueview.ecosure.com";
const KEYCHAIN_SERVICE = "scrapekit.ecosure";
const DATA_DIR    = path.join(os.homedir(), ".scrapekit", "ecosure-browser-data");
const LOCK_FILE   = path.join(os.homedir(), ".scrapekit", "browser.lock");
const SHOT_DIR    = path.join(os.homedir(), ".scrapekit", "screenshots");

// Hosts the browser is allowed to reach. All other requests are aborted.
const ALLOWED_HOSTS = [
  "trueview.ecosure.com",
  "api.trueview.ecosure.com",
  "ecolabb2c.b2clogin.com",
  "account.ecolab.com",
  "analytics-bi.trueview.ecosure.com",
  "analyticsdocs.trueview.ecosure.com",
  // Azure AD / B2C authentication infrastructure
  "login.microsoftonline.com",
  "secure.aadcdn.microsoftonline-p.com",
  "aadcdn.msauth.net",
  "msauth.net",
  // Allow any subdomain of the above
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  process.stdout.write(`[ecosure] ${msg}\n`);
}

function isAllowed(url) {
  try {
    const hostname = new URL(url).hostname;
    return ALLOWED_HOSTS.some(
      (h) => hostname === h || hostname.endsWith("." + h),
    );
  } catch {
    return false;
  }
}

/** Acquire a file-based lock, waiting up to timeoutMs. */
async function acquireLock(timeoutMs = 120_000) {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
      return; // acquired
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error("Could not acquire browser lock after 2 minutes — is another scrapekit job running?");
}

function releaseLock() {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // already gone — that's fine
  }
}

function screenshot(page, label) {
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const name = `ecosure-${label}-${Date.now()}.png`;
    const dest = path.join(SHOT_DIR, name);
    page.screenshot({ path: dest, fullPage: true }).catch(() => {});
    log(`Screenshot saved: ${dest}`);
  } catch {}
}

// ─── Keychain helpers (macOS) ─────────────────────────────────────────────────

function keychainGet(account) {
  try {
    return execFileSync("security", [
      "find-generic-password",
      "-s", KEYCHAIN_SERVICE,
      "-a", account,
      "-w",
    ], { stdio: ["pipe", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

function keychainSet(account, password) {
  execFileSync("security", [
    "add-generic-password",
    "-s", KEYCHAIN_SERVICE,
    "-a", account,
    "-w", password,
    "-U",
  ]);
}

function keychainGetAccount() {
  // Retrieve the stored account (email) from a known helper entry.
  // We store the account name under a fixed "account" key.
  try {
    return execFileSync("security", [
      "find-generic-password",
      "-s", KEYCHAIN_SERVICE + ".account",
      "-a", "account",
      "-w",
    ], { stdio: ["pipe", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

function keychainSetAccount(email) {
  execFileSync("security", [
    "add-generic-password",
    "-s", KEYCHAIN_SERVICE + ".account",
    "-a", "account",
    "-w", email,
    "-U",
  ]);
}

// ─── Supabase client ──────────────────────────────────────────────────────────

function supabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ─── login command ────────────────────────────────────────────────────────────
// Prompts for TrueView email + password and saves them to Keychain.
// Run once; check picks them up automatically.

async function login() {
  const readline = require("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));

  try {
    const email    = (await ask("TrueView email: ")).trim();
    const password = (await ask("TrueView password: ")).trim();
    if (!email || !password) throw new Error("Email and password are required");
    keychainSetAccount(email);
    keychainSet(email, password);
    log(`Credentials saved to Keychain (service: ${KEYCHAIN_SERVICE})`);
  } finally {
    rl.close();
  }
}

// ─── check command ────────────────────────────────────────────────────────────

async function check(opts = {}) {
  const account  = keychainGetAccount();
  if (!account) throw new Error("No credentials found — run: scrapekit ecosure login");
  const password = keychainGet(account);
  if (!password) throw new Error("Password not found in Keychain — run: scrapekit ecosure login");

  await acquireLock();
  let context;
  try {
    context = await launchContext();
    const page = await context.newPage();

    // Network allowlist
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (isAllowed(url)) {
        route.continue();
      } else {
        route.abort("blockedbyclient");
      }
    });

    // ── 1. Login ────────────────────────────────────────────────────────────
    log("Navigating to TrueView portal…");
    await page.goto(PORTAL_URL, { waitUntil: "networkidle", timeout: 60_000 });

    // The portal redirects to Azure B2C. Wait for the email field.
    try {
      await page.waitForSelector('input[type="email"], #signInName', { timeout: 20_000 });
    } catch {
      screenshot(page, "login-no-email-field");
      throw new Error("Could not find email field on the login page. Screenshot saved.");
    }

    await page.fill('input[type="email"], #signInName', account);

    // Click Next / Continue if the page has a two-step flow
    const nextBtn = page.locator('button:has-text("Next"), input[value="Next"]').first();
    if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(1000);
    }

    // Password field
    try {
      await page.waitForSelector('input[type="password"], #password', { timeout: 15_000 });
    } catch {
      screenshot(page, "login-no-password-field");
      throw new Error("Could not find password field. Screenshot saved.");
    }
    await page.fill('input[type="password"], #password', password);

    // Submit
    const submitBtn = page.locator(
      'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in")',
    ).first();
    await submitBtn.click();

    // ── 2. MFA / verification code detection ────────────────────────────────
    // Wait briefly to see if an MFA or verification code screen appears.
    await page.waitForTimeout(3000);

    const mfaSelectors = [
      'input[name="otpCode"]',
      'input[aria-label*="verification"]',
      'input[aria-label*="code"]',
      'input[placeholder*="code"]',
    ];
    for (const sel of mfaSelectors) {
      if (await page.locator(sel).isVisible({ timeout: 1000 }).catch(() => false)) {
        screenshot(page, "mfa-prompt");
        log("⚠️  MFA / verification code prompt detected — cannot proceed automatically.");
        log("   Screenshot saved. Manual intervention required.");
        throw new Error("MFA_REQUIRED: A verification code was requested at login.");
      }
    }

    // ── 3. Wait for TrueView to load ─────────────────────────────────────────
    log("Logging in…");
    try {
      await page.waitForURL("**/trueview.ecosure.com/**", { timeout: 30_000 });
    } catch {
      // May already be there via redirect
    }
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    log("Logged in successfully.");

    // ── 4. Navigate to the Assessments report ────────────────────────────────
    // INTEGRATION NOTE: Adjust this selector/URL for your TrueView tenant.
    // Typically the portal has a sidebar or top nav with "Assessments" or
    // "Inspection Summary" link.
    log("Navigating to Assessments report…");
    const navLink = page.locator(
      'a:has-text("Assessments"), a:has-text("Inspection Summary"), nav a[href*="assessment"]',
    ).first();

    if (await navLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await navLink.click();
      await page.waitForLoadState("networkidle", { timeout: 30_000 });
    } else {
      log("Could not find Assessments nav link — assuming already on correct page");
    }

    // ── 5. Export: List of Assessments ───────────────────────────────────────
    log("Exporting List of Assessments…");
    const assessmentsPath = await exportVisual(page, "List of Assessments", "assessments");

    // ── 6. Export: Standard Details ──────────────────────────────────────────
    log("Exporting Standard Details…");
    const findingsPath = await exportVisual(page, "Standard Details", "findings");

    await context.close();
    context = null;

    // ── 7. Parse ─────────────────────────────────────────────────────────────
    log("Parsing assessments xlsx…");
    const assessmentRows = parseAssessmentsXlsx(assessmentsPath);
    log(`  → ${assessmentRows.length} assessment rows`);

    log("Parsing findings xlsx…");
    const findingRows = parseFindingsXlsx(findingsPath);
    log(`  → ${findingRows.length} finding rows`);

    // ── 8. Push to Supabase ──────────────────────────────────────────────────
    const supa = supabase();

    log("Pushing assessments to Supabase…");
    const { data: aResult, error: aErr } = await supa.rpc(
      "scrapekit_ecosure_upsert_assessments",
      { p_rows: assessmentRows },
    );
    if (aErr) throw new Error(`Assessments upsert failed: ${aErr.message}`);
    log(`  → ${JSON.stringify(aResult)}`);

    if (findingRows.length > 0) {
      log("Pushing findings to Supabase…");
      // Chunk to avoid payload limits (2500 rows max per call)
      const CHUNK = 2500;
      let totalUpserted = 0;
      for (let i = 0; i < findingRows.length; i += CHUNK) {
        const chunk = findingRows.slice(i, i + CHUNK);
        const { data: fResult, error: fErr } = await supa.rpc(
          "scrapekit_ecosure_upsert_findings",
          { p_rows: chunk },
        );
        if (fErr) throw new Error(`Findings upsert failed: ${fErr.message}`);
        totalUpserted += fResult?.upserted ?? 0;
      }
      log(`  → ${totalUpserted} findings upserted`);
    }

    log("Done.");
    return { ok: true, assessments: assessmentRows.length, findings: findingRows.length };
  } catch (err) {
    log(`ERROR: ${err.message}`);
    throw err;
  } finally {
    if (context) {
      try { await context.close(); } catch {}
    }
    releaseLock();
  }
}

// ─── Playwright helpers ───────────────────────────────────────────────────────

async function launchContext() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return chromium.launchPersistentContext(DATA_DIR, {
    headless: true,
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
    // Chromium args for headless server environments
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
}

/**
 * Export a Power BI visual as xlsx.
 * Hovers over the visual to reveal the ⋯ menu, clicks Export, waits for the download.
 *
 * INTEGRATION NOTE: Power BI "More options" button selectors and the exact menu
 * label ("Export data" vs just "Export") vary by portal configuration. If the
 * default selectors below don't work, check the DOM with a headed run and update.
 *
 * @param {import('playwright').Page} page
 * @param {string} visualTitle  Partial match against aria-label or title
 * @param {string} label        Used in screenshot filename on failure
 */
async function exportVisual(page, visualTitle, label) {
  // Locate the visual container
  const visualContainer = page
    .locator(
      `[aria-label*="${visualTitle}"], [title*="${visualTitle}"], .visual-container:has(*[title*="${visualTitle}"])`,
    )
    .first();

  if (!await visualContainer.isVisible({ timeout: 15_000 }).catch(() => false)) {
    screenshot(page, `${label}-no-visual`);
    throw new Error(`Visual "${visualTitle}" not found on page. Screenshot saved.`);
  }

  // Hover to reveal the ⋯ button
  await visualContainer.hover();
  await page.waitForTimeout(500);

  // Click ⋯ (More options)
  const moreBtn = page
    .locator('button[aria-label="More options"], button[title="More options"], button.moreOptions')
    .last(); // "last" because there may be multiple visuals; hover puts ours in focus

  if (!await moreBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    screenshot(page, `${label}-no-more-btn`);
    throw new Error(`"More options" button not found for visual "${visualTitle}". Screenshot saved.`);
  }
  await moreBtn.click();
  await page.waitForTimeout(400);

  // Click Export / Export data in the dropdown
  const exportItem = page
    .locator(
      '[role="menuitem"]:has-text("Export data"), [role="menuitem"]:has-text("Export"), [role="option"]:has-text("Export")',
    )
    .first();

  if (!await exportItem.isVisible({ timeout: 5000 }).catch(() => false)) {
    screenshot(page, `${label}-no-export-menu`);
    throw new Error(`Export menu item not found for visual "${visualTitle}". Screenshot saved.`);
  }
  await exportItem.click();
  await page.waitForTimeout(400);

  // If a format/data-type dialog appears, choose xlsx / underlying data
  const xlsxOption = page
    .locator('[role="option"]:has-text(".xlsx"), [role="radio"]:has-text("Underlying"), button:has-text("Export")')
    .first();

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    (async () => {
      if (await xlsxOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await xlsxOption.click();
        // Look for a final "Export" confirm button
        const confirmBtn = page.locator('button:has-text("Export"), button:has-text("OK")').last();
        if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmBtn.click();
        }
      }
    })(),
  ]).catch(async (err) => {
    screenshot(page, `${label}-download-fail`);
    throw new Error(`Download failed for "${visualTitle}": ${err.message}. Screenshot saved.`);
  });

  const tmpPath = await download.path();
  if (!tmpPath) {
    throw new Error(`Download produced no file for "${visualTitle}"`);
  }
  log(`  Downloaded: ${path.basename(tmpPath)}`);
  return tmpPath;
}

// ─── Module export (scrapekit connector interface) ────────────────────────────

module.exports = {
  name: "ecosure",
  commands: ["login", "check"],
  login,
  check,
};

// ─── Direct CLI shim ──────────────────────────────────────────────────────────
// Allows: node ecosure/index.js login | check
// Remove or guard this if the scrapekit CLI framework handles dispatch itself.

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === "login") {
    login().catch((e) => { console.error(e.message); process.exit(1); });
  } else if (cmd === "check") {
    check().catch((e) => { console.error(e.message); process.exit(1); });
  } else {
    console.error("Usage: node ecosure/index.js <login|check>");
    process.exit(1);
  }
}
