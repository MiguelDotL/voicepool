// ElevenLabs signup automation orchestrator.
//
// Drives a headless Chromium session through: signup → email verify → login →
// API key extraction → register account → add default voices.
// Coordinated with the existing IMAP poller, which writes the verification
// link to the signup row — this worker waits on that field.
//
// Selector strategy: prefer accessibility-based selectors (getByLabel,
// getByRole) over CSS — they survive minor UI tweaks and are stable across
// rebrands. Update this comment block when EL changes their UI so the
// breakage history is visible at a glance.
//
//   Signup page:  https://elevenlabs.io/app/sign-up
//     email input:    getByLabel(/email/i)
//     password input: getByLabel(/password/i)
//     submit button:  getByRole("button", { name: /sign ?up/i })
//
//   Sign-in page: https://elevenlabs.io/app/sign-in
//     email input:    getByLabel(/email/i)
//     password input: getByLabel(/password/i)
//     submit button:  getByRole("button", { name: /(sign ?in|log ?in)/i })
//
//   API keys page: https://elevenlabs.io/app/settings/api-keys
//     create button:  getByRole("button", { name: /create.*api.*key|generate/i })
//     name input:     getByLabel(/name|description/i)
//     key value:      input[readonly] | [data-testid*="api-key" i] | code (key starts with "sk_")
//
//   Voices page: https://elevenlabs.io/app/voice-lab
//     search input:   getByPlaceholder(/search/i)
//     add (+) button: getByRole("button", { name: /add( to my voices)?|^\+$/i })

import type { Browser, BrowserContext, Page } from "playwright";
import { run, runChanges, queryOne } from "../db/index.js";
import { decrypt } from "./encryption.js";
import type { SignupRow } from "./signups.js";
import { createAccountFromKey } from "../routes/accounts.js";

const VERIFY_LINK_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const VERIFY_LINK_POLL_MS = 2_000;

let browser: Browser | null = null;
const queue: number[] = [];
let workerActive = false;
let cancelRequested = false;
let activeContext: BrowserContext | null = null;
// Pages opened by the interactive signup launcher, indexed by signupId.
// Worker picks up the same page so there's ONE browser window per provision
// (instead of two — one for the user's signup form, one for the worker).
// Sharing the page also preserves session cookies, so worker can skip /sign-in.
const interactivePages = new Map<number, Page>();

export function isAutomationEnabled(): boolean {
  return (
    process.env.EL_AUTOMATION_ENABLED === "true" &&
    Boolean(process.env.EL_SHARED_PASSWORD)
  );
}

export function enqueue(signupId: number): void {
  if (queue.includes(signupId)) return;
  queue.push(signupId);
  void runWorker();
}

async function runWorker(): Promise<void> {
  if (workerActive) return;
  workerActive = true;
  try {
    while (queue.length > 0) {
      if (cancelRequested) break;
      const id = queue.shift()!;
      try {
        await processSignup(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[elAutomation] signup ${id} failed:`, msg);
        markFailed(id, msg);
      }
    }
  } finally {
    workerActive = false;
  }
}

async function processSignup(signupId: number): Promise<void> {
  const row = queryOne<SignupRow>("SELECT * FROM signups WHERE id = ?", [signupId]);
  if (!row) throw new Error(`signup ${signupId} not found`);
  if (!row.password) throw new Error("signup row has no password (EL_SHARED_PASSWORD was not set when generated)");

  const password = decrypt(row.password);

  setStatus(signupId, "automating", "starting");
  // Reuse the page the user signed up on — same browser, session cookies kept.
  // Falls back to a fresh context if the interactive flow wasn't used (e.g.
  // signup created via API directly).
  const reused = interactivePages.get(signupId) ?? null;
  const ctx: BrowserContext = reused ? reused.context() : await openContext();
  activeContext = ctx;
  try {
    const page = reused ?? (await ctx.newPage());
    if (reused) {
      console.log(`[worker ${signupId}] reusing interactive page`);
    }

    // Hybrid flow: if the IMAP poller already wrote a verify link, the user
    // did the signup form manually in their real browser (avoiding hCaptcha).
    // Skip stepSignup and stepWait entirely.
    let link = row.verification_link;
    if (!link) {
      setStep(signupId, "submitting signup");
      await stepSignup(page, row.email, password);

      setStep(signupId, "waiting for verification email");
      link = await waitForVerificationLink(signupId);
    }

    setStep(signupId, "verifying email");
    try {
      await stepVerify(page, link);
    } catch (err) {
      // Verify links are one-shot (Firebase oobCode). On retry the link is
      // spent — but the email is already verified from the prior run. Fall
      // through to login; if email truly isn't verified, login will fail
      // with EL's "verification needed" page and we surface that.
      console.warn(`[worker] stepVerify failed, falling through to login:`, err);
      await page.goto("https://elevenlabs.io/app/sign-in", { waitUntil: "domcontentloaded" });
    }

    setStep(signupId, "logging in");
    await stepEnsureLoggedIn(page, row.email, password);

    // Phase 3 will fill these in:
    const apiKey = await stepExtractApiKey(page, row.email, signupId);

    setStep(signupId, "registering account");
    await stepRegisterAccount(signupId, apiKey, row.email);

    // Phase 4 will fill this in:
    setStep(signupId, "adding voices");
    await stepAddDefaultVoices(page, apiKey, signupId);

    runChanges(
      `UPDATE signups
         SET status = 'verified',
             automation_step = NULL,
             verified_at = COALESCE(verified_at, datetime('now'))
       WHERE id = ?`,
      [signupId]
    );
  } finally {
    activeContext = null;
    interactivePages.delete(signupId);
    await ctx.close().catch(() => { /* ignore */ });
  }
}

// ---------------------------------------------------------------------------
// Step implementations — selectors filled in Phase 2b/3/4 from recon notes.
// ---------------------------------------------------------------------------

async function stepSignup(page: Page, email: string, password: string): Promise<void> {
  await page.goto("https://elevenlabs.io/app/sign-up", { waitUntil: "domcontentloaded" });

  // EL is a SPA — wait for the email input to actually mount before continuing.
  await page.waitForSelector('input[type="email"]', { state: "visible", timeout: 30_000 });

  await fillEmail(page, email);
  await fillPassword(page, password);

  // Exact text match avoids "Sign up with Google" SSO button (which appears
  // first in the DOM and would otherwise match a loose /sign ?up/ regex).
  await page.getByRole("button", { name: /^sign ?up$/i }).first().click();

  // Wait briefly for either a navigation, captcha, or inline error to appear.
  await page
    .waitForURL((url) => !url.pathname.includes("/sign-up"), { timeout: 15_000 })
    .catch(() => { /* fallthrough to inline diagnostics */ });

  if (page.url().includes("/sign-up")) {
    // Still on signup — diagnose. Save a screenshot, then look for captcha or
    // inline error text, and throw with what we found.
    const shotPath = `/tmp/voicepool-signup-fail.png`;
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => { /* ignore */ });

    const captchaChallenge = page.locator(
      'iframe[title*="hcaptcha challenge" i], iframe[title*="captcha" i]'
    );
    if (await captchaChallenge.first().isVisible().catch(() => false)) {
      throw new Error(`hCaptcha challenge surfaced — finish signup manually (screenshot: ${shotPath})`);
    }

    // Scrape visible error/help text. EL typically renders inline errors in
    // small spans/divs near the input or as a banner.
    const errorText = await page
      .locator('[role="alert"], [class*="error" i], [class*="Error" i], [class*="warning" i]')
      .allTextContents()
      .catch(() => [] as string[]);
    const visibleErrors = errorText
      .map((s) => s.trim())
      .filter((s) => s && s.length < 300);

    const summary = visibleErrors.length > 0
      ? visibleErrors.slice(0, 3).join(" | ")
      : "no visible error message";

    throw new Error(`signup form did not navigate after submit — ${summary} (screenshot: ${shotPath})`);
  }
}

// Robust email-input filler — tries several selector strategies because EL's
// markup may not use <label> associations.
async function fillEmail(page: Page, value: string): Promise<void> {
  const candidates = [
    page.locator('input[type="email"]').first(),
    page.locator('input[name="email" i]').first(),
    page.locator('input[autocomplete="email"]').first(),
    page.locator('input[placeholder*="email" i]').first(),
    page.locator('input[aria-label*="email" i]').first(),
    page.getByLabel(/email/i).first(),
  ];
  for (const loc of candidates) {
    if (await loc.isVisible().catch(() => false)) {
      await loc.fill(value);
      return;
    }
  }
  throw new Error("could not find email input");
}

async function fillPassword(page: Page, value: string): Promise<void> {
  const candidates = [
    page.locator('input[type="password"]').first(),
    page.locator('input[name="password" i]').first(),
    page.locator('input[autocomplete="new-password"]').first(),
    page.locator('input[autocomplete="current-password"]').first(),
    page.getByLabel(/password/i).first(),
  ];
  for (const loc of candidates) {
    if (await loc.isVisible().catch(() => false)) {
      await loc.fill(value);
      return;
    }
  }
  throw new Error("could not find password input");
}

async function stepVerify(page: Page, link: string): Promise<void> {
  // EL's verify URL is a Firebase action page (.../app/action?mode=verifyEmail&oobCode=...).
  // Verification completes via client-side JS calling Firebase's applyActionCode.
  // We must wait for that to finish AND click any "Continue" button before the
  // email is considered verified by EL's backend — otherwise the next sign-in
  // hits "we sent you a verification email" because verification never landed.
  await page.goto(link, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => { /* ignore */ });

  // If EL's verify page shows a continue/finish button, click it.
  const continueBtn = page
    .getByRole("button", { name: /continue|verify|finish|sign ?in to (your )?account|go to (app|dashboard)/i })
    .first();
  if (await continueBtn.isVisible().catch(() => false)) {
    await continueBtn.click().catch(() => { /* ignore */ });
  }

  // Wait for the URL to leave the Firebase action page. After that we should
  // be on /sign-in (manual login) or /app (auto-logged-in).
  await page
    .waitForURL((url) => !url.pathname.includes("/action"), { timeout: 30_000 })
    .catch(async () => {
      const shot = `/tmp/voicepool-verify-stuck.png`;
      await page.screenshot({ path: shot, fullPage: true }).catch(() => { /* ignore */ });
      throw new Error(`verify page never left /action — page may need manual click (screenshot: ${shot})`);
    });

  // One final settle for redirects.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => { /* ignore */ });
}

// In EL's "Create API Key" modal, each endpoint row is an <li class="eleven-list-item">
// with the endpoint name in a <span> and a Radix tablist of permission tabs. Tab
// buttons have stable IDs ending in -trigger-{none|access|read|write}.
// Scope to the row's <li> first — otherwise an ambient ancestor div matches
// permission tabs from a different row.
async function grantEndpointTab(page: Page, endpoint: string, permission: "Access" | "Read" | "Write"): Promise<void> {
  // Scope to <li class="eleven-list-item"> that ALSO contains a tablist —
  // excludes sidebar nav items that share the "Voices"/"User" label but have
  // no permission tabs.
  const row = page.locator("li.eleven-list-item").filter({
    has: page.getByText(endpoint, { exact: true }),
  }).filter({
    has: page.locator('[role="tablist"]'),
  }).first();
  if (await row.count() === 0) {
    console.log(`[automation] grantEndpointTab: row not found for "${endpoint}"`);
    return;
  }
  const tab = row.locator(`button[role="tab"][id$="-trigger-${permission.toLowerCase()}"]`).first();
  if (await tab.count() === 0) {
    console.log(`[automation] grantEndpointTab: "${permission}" tab not found in "${endpoint}" row`);
    return;
  }
  if (await tab.isDisabled().catch(() => false)) {
    console.log(`[automation] grantEndpointTab: "${endpoint}/${permission}" tab is disabled (likely free-tier restriction)`);
    return;
  }
  await tab.click({ timeout: 5_000 });
  const state = await tab.getAttribute("data-state").catch(() => null);
  if (state !== "active") {
    console.log(`[automation] grantEndpointTab: "${endpoint}/${permission}" clicked but data-state=${state}`);
  } else {
    console.log(`[automation] grantEndpointTab: "${endpoint}" → ${permission} ✓`);
  }
}

// New accounts land in EL's onboarding wizard — a 6-step interview that all
// happens at the same URL (/app/onboarding). Each step renders a Continue
// button; some steps require selecting a card first to enable Continue.
// Strategy: only click the card if Continue is disabled, click Continue,
// wait for content change, repeat up to N steps.
async function skipOnboardingIfPresent(page: Page, email?: string): Promise<void> {
  // EL shows a logo splash for ~3-5s before rendering the wizard. 6s covers
  // the splash + a small buffer; longer waits just slow the happy path.
  await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => { /* ignore */ });
  await page
    .locator("button")
    .filter({ hasText: /^(Continue|Next|Skip|Get started)$/ })
    .first()
    .waitFor({ state: "visible", timeout: 6_000 })
    .catch(() => { /* fall through; loop will exit if still nothing */ });

  let safety = 0;
  let lastBodySig = "";
  let stuckCount = 0;
  while (page.url().includes("/onboarding") && safety < 20) {
    safety++;
    // Per-step screenshot for debugging — overwrites each iteration.
    await page.screenshot({ path: `/tmp/voicepool-onboarding-step${safety}.png`, fullPage: true })
      .catch(() => { /* ignore */ });

    // Prefer "Skip" if present. Otherwise the form's submit button — EL puts
    // Continue/Next inside a <form> so this targets it directly without
    // collision with sidebar buttons (e.g. "New chat").
    const skipLink = page
      .locator("a, button")
      .filter({ hasText: /^Skip$|^Skip for now$/ })
      .first();
    const formSubmit = page
      .locator('form button[type="submit"]')
      .filter({ hasText: /^(Continue|Next|Get started|Finish|Done)$/ })
      .first();
    const textMatch = page
      .locator("button")
      .filter({ hasText: /^(Continue|Next|Get started|Finish|Done)$/ })
      .first();

    let advanceBtn = skipLink;
    if (!(await skipLink.isVisible().catch(() => false))) {
      advanceBtn = formSubmit;
      if (!(await formSubmit.isVisible().catch(() => false))) {
        advanceBtn = textMatch;
        if (!(await textMatch.isVisible().catch(() => false))) {
          console.log(`[onboarding] step ${safety}: no Skip / Continue / Next visible, exiting`);
          break;
        }
      }
    }

    // EL uses Radix checkboxes — <button role="checkbox" aria-checked="...">
    // — not native <input>. Click only when aria-checked is false.
    const radixBoxes = await page.getByRole("checkbox").all();
    for (const cb of radixBoxes) {
      const state = await cb.getAttribute("aria-checked").catch(() => null);
      if (state !== "true") {
        await cb.click({ force: true }).catch(() => { /* ignore */ });
      }
    }
    // Fallback for any actual <input type="checkbox"> elements.
    const inputBoxes = await page.locator('input[type="checkbox"]').all();
    for (const cb of inputBoxes) {
      await cb.setChecked(true, { force: true }).catch(() => { /* ignore */ });
    }

    // Fill any blank text inputs. The "What's your name?" field on EL's age
    // step is labeled optional but blocks Continue if empty. Use the row's
    // email so each account is identifiable in EL's admin view.
    const fillValue = email ?? "VP";
    const textInputs = await page.locator('input[type="text"]:not([readonly])').all();
    for (const ti of textInputs) {
      const value = await ti.inputValue().catch(() => "");
      if (!value) {
        await ti.fill(fillValue).catch(() => { /* ignore */ });
      }
    }

    const disabled = await advanceBtn.isDisabled().catch(() => false);
    if (disabled) {
      // Platform-choice step: select ElevenCreative card.
      const card = page.locator(':text("ElevenCreative")').first();
      if (await card.isVisible().catch(() => false)) {
        await card.click().catch(() => { /* ignore */ });
        await page.waitForTimeout(400);
      }
    }

    const before = (await page.locator("body").innerText().catch(() => "")).slice(0, 800);
    console.log(`[onboarding] step ${safety}: clicking advance at ${page.url()}`);
    await advanceBtn.click({ force: true, timeout: 5_000 }).catch((e) => {
      console.warn(`[onboarding] click err:`, e instanceof Error ? e.message : e);
    });
    await page.waitForTimeout(1500);

    const after = (await page.locator("body").innerText().catch(() => "")).slice(0, 800);
    if (after === before) {
      stuckCount++;
      console.log(`[onboarding] step ${safety}: body unchanged (stuck=${stuckCount})`);
      if (stuckCount === 1) {
        const shot = `/tmp/voicepool-onboarding-stuck.png`;
        await page.screenshot({ path: shot, fullPage: true }).catch(() => { /* ignore */ });
        const inputs = await page.locator("input, textarea").all();
        const inputInfo: Array<{ type: string; name: string; placeholder: string }> = [];
        for (const inp of inputs) {
          const info = await inp.evaluate((el) => ({
            type: (el as { type?: string }).type ?? el.tagName,
            name: (el as { name?: string }).name ?? "",
            placeholder: (el as { placeholder?: string }).placeholder ?? "",
          })).catch(() => ({ type: "?", name: "", placeholder: "" }));
          inputInfo.push(info);
        }
        // Buttons and links — to find a Skip we may have missed.
        const clickables = await page.locator("button, a").all();
        const clickInfo: Array<{ tag: string; text: string }> = [];
        for (const c of clickables) {
          const info = await c.evaluate((el) => ({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent ?? "").trim().slice(0, 40),
          })).catch(() => ({ tag: "?", text: "" }));
          if (info.text) clickInfo.push(info);
        }
        const headings = await page.locator("h1, h2, h3").allTextContents().catch(() => [] as string[]);
        console.log(`[onboarding] stuck headings: ${JSON.stringify(headings.slice(0, 5))}`);
        console.log(`[onboarding] stuck inputs: ${JSON.stringify(inputInfo)}`);
        console.log(`[onboarding] stuck clickables: ${JSON.stringify(clickInfo.slice(0, 30))}`);
        console.log(`[onboarding] screenshot: ${shot}`);
      }
      if (stuckCount >= 2) {
        console.log(`[onboarding] giving up after ${safety} iterations`);
        break;
      }
    } else {
      stuckCount = 0;
    }
    lastBodySig = after;
  }
}

async function stepEnsureLoggedIn(page: Page, email: string, password: string): Promise<void> {
  // If we already passed /sign-in (verify auto-logged in), nothing to do.
  if (!page.url().includes("/sign-in")) return;

  await fillEmail(page, email);
  await fillPassword(page, password);

  // EL's sign-in page has THREE submit buttons: Google SSO, Apple SSO, and
  // the email/password "Sign in". Match the email form's button by exact text.
  const submitBtn = page.getByRole("button", { name: "Sign in", exact: true });
  if (await submitBtn.isVisible().catch(() => false)) {
    await submitBtn.click();
  } else {
    // Fallback: press Enter on password field — triggers default form submit.
    await page.locator('input[type="password"]').first().press("Enter");
  }

  try {
    // Generous timeout because EL may show "verification email sent" if the
    // account isn't verified yet — gives the user time to manually navigate
    // to the new verify link in this Playwright window.
    await page.waitForURL((url) => !url.pathname.includes("/sign-in"), { timeout: 300_000 });
  } catch (err) {
    // Capture state for debugging — what does the page show post-click?
    const shot = `/tmp/voicepool-login-fail.png`;
    await page.screenshot({ path: shot, fullPage: true }).catch(() => { /* ignore */ });
    const errorText = await page
      .locator('[role="alert"], [class*="error" i], [class*="Error" i], [class*="warning" i], [class*="invalid" i]')
      .allTextContents()
      .catch(() => [] as string[]);
    const visibleErrors = errorText.map((s) => s.trim()).filter((s) => s && s.length < 300);
    const summary = visibleErrors.length > 0
      ? visibleErrors.slice(0, 3).join(" | ")
      : "no visible error message";
    const url = page.url();
    throw new Error(`login did not navigate (still at ${url}) — ${summary} (screenshot: ${shot})`);
  }
}

async function stepExtractApiKey(page: Page, email: string, signupId: number): Promise<string> {
  // First-time accounts land on /app/onboarding. skipOnboardingIfPresent walks
  // the wizard automatically — Skip / form-submit Continue/Next, ticks Radix
  // checkboxes, fills the optional name input, selects ElevenCreative when the
  // platform-choice step gates Continue.
  if (page.url().includes("/onboarding")) {
    setStep(signupId, "completing onboarding");
    await skipOnboardingIfPresent(page, email);
  }
  setStep(signupId, "extracting api key");

  // Onboarding cleared. Now safe to navigate to API keys.
  await page.goto("https://elevenlabs.io/app/developers/api-keys", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => { /* ignore */ });

  // Button text on EL's API keys page is "Create Key" (the "+" is an icon,
  // not in the accessible name).
  const createBtn = page
    .getByRole("button", { name: /^(\+\s*)?create( api| new)? key$|^new api key$|^generate( api)? key$/i })
    .first();
  try {
    await createBtn.click({ timeout: 15_000 });
  } catch {
    const buttons = await page.locator("button, a[role='button']").all();
    const labels: string[] = [];
    for (const b of buttons) {
      const info = await b
        .evaluate((el) => ({
          text: (el.textContent ?? "").trim().slice(0, 60),
          visible: ("offsetParent" in el) && (el as { offsetParent: unknown }).offsetParent != null,
        }))
        .catch(() => ({ text: "", visible: false }));
      if (info.visible && info.text) labels.push(info.text);
    }
    const shot = `/tmp/voicepool-apikey-fail.png`;
    await page.screenshot({ path: shot, fullPage: true }).catch(() => { /* ignore */ });
    throw new Error(`could not find Create Key button at ${page.url()}. Visible buttons: ${JSON.stringify(labels.slice(0, 25))}. Screenshot: ${shot}`);
  }

  // Modal opens. Fill the name with "VoicePool" (default is a random animal).
  const nameInput = page.locator('input[placeholder*="API Key Name" i], input[placeholder*="key name" i]').first();
  if (await nameInput.isVisible().catch(() => false)) {
    await nameInput.fill("VoicePool");
  }

  // Restrict Key stays ON — grant only the endpoints voicepool actually uses:
  //   - Text to Speech: Access (for synthesize)
  //   - Voices: Read       (for /v1/voices lookup after voice add)
  //   - User: Read         (for /v1/user → usage snapshot)
  // Note: User: Write is disabled on free EL accounts (cannot grant a
  // permission you don't have yourself).
  await grantEndpointTab(page, "Text to Speech", "Access");
  await grantEndpointTab(page, "Voices", "Write");
  await grantEndpointTab(page, "User", "Read");

  // Cap monthly credit usage so a runaway client can't blow through the whole
  // 10k free allowance in one go. The "Monthly" row holds a number input with
  // placeholder="Unlimited"; matches free-tier plan ceiling.
  const monthlyRow = page.locator("li").filter({ has: page.getByText("Monthly", { exact: true }) }).first();
  const monthlyInput = monthlyRow.locator('input[type="number"]').first();
  if (await monthlyInput.count() > 0) {
    await monthlyInput.fill("10000").catch(() => { /* ignore */ });
  }

  // Bottom "Create Key" button confirms creation.
  await page.getByRole("button", { name: /^create key$/i }).last().click({ timeout: 10_000 });

  // EL shows the freshly-created key once. Scrape it from the visible input/code.
  // Wait a moment for the modal to render the key value.
  await page.waitForTimeout(1_500);

  const candidates = [
    page.locator('input[readonly]'),
    page.locator('input[type="text"]'),
    page.locator('[data-testid*="api-key" i]'),
    page.locator('code'),
  ];
  for (const loc of candidates) {
    const count = await loc.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);
      const value =
        (await el.inputValue().catch(() => null)) ??
        (await el.textContent().catch(() => null));
      const trimmed = value?.trim();
      if (trimmed && trimmed.startsWith("sk_")) return trimmed;
    }
  }

  const shot = `/tmp/voicepool-apikey-scrape-fail.png`;
  await page.screenshot({ path: shot, fullPage: true }).catch(() => { /* ignore */ });
  throw new Error(`could not locate freshly-created API key on dashboard (screenshot: ${shot})`);
}

async function stepRegisterAccount(signupId: number, apiKey: string, email: string): Promise<void> {
  // Use the row's email as the label — fresh accounts have no first_name set
  // on EL's side, so createAccountFromKey would otherwise fall through to "Unnamed".
  const account = await createAccountFromKey(apiKey, email);
  runChanges(
    `UPDATE signups SET account_id = ? WHERE id = ?`,
    [account.id, signupId]
  );
}

async function stepAddDefaultVoices(_page: Page, apiKey: string, signupId: number): Promise<void> {
  const raw = process.env.EL_DEFAULT_VOICES ?? "";
  const names = raw.split(",").map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return;

  const signup = queryOne<SignupRow>("SELECT * FROM signups WHERE id = ?", [signupId]);
  const accountId = signup?.account_id;
  if (!accountId) throw new Error("account_id not set on signup row before voice add");

  for (const name of names) {
    setStep(signupId, `adding voice: ${name}`);

    // Find the public shared voice by name. EL's /v1/shared-voices supports a
    // ?search= filter and returns public_owner_id + voice_id, which we need
    // for the add endpoint.
    const searchUrl = `https://api.elevenlabs.io/v1/shared-voices?search=${encodeURIComponent(name)}&page_size=20`;
    const sRes = await fetch(searchUrl, { headers: { "xi-api-key": apiKey } });
    if (!sRes.ok) {
      throw new Error(`EL /v1/shared-voices returned ${sRes.status} ${sRes.statusText}`);
    }
    const sData = (await sRes.json()) as {
      voices?: { name: string; voice_id: string; public_owner_id: string }[];
    };
    // EL's voice names are often longer than the search query — e.g. searching
    // "Declan Sage" returns "Declan Sage - Wise and Captivating". Prefer exact
    // match if present; otherwise the top result that contains the query.
    const haystack = sData.voices ?? [];
    const lower = name.toLowerCase();
    const shared =
      haystack.find((v) => v.name.toLowerCase() === lower) ??
      haystack.find((v) => v.name.toLowerCase().includes(lower));
    if (!shared) {
      throw new Error(`shared voice "${name}" not found in EL voice library`);
    }

    // POST /v1/voices/add/{public_user_id}/{voice_id} — adds the shared voice
    // to this account's "My Voices" and returns a new private voice_id.
    const addUrl = `https://api.elevenlabs.io/v1/voices/add/${shared.public_owner_id}/${shared.voice_id}`;
    const aRes = await fetch(addUrl, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ new_name: name }),
    });
    if (!aRes.ok) {
      throw new Error(`EL voice add returned ${aRes.status} ${aRes.statusText}: ${await aRes.text().catch(() => "")}`);
    }
    const aData = (await aRes.json()) as { voice_id?: string };
    const privateVoiceId = aData.voice_id;
    if (!privateVoiceId) {
      throw new Error(`voice add response missing voice_id for "${name}"`);
    }

    try {
      run(
        `INSERT INTO account_voices (account_id, voice_name, voice_id) VALUES (?, ?, ?)`,
        [accountId, name, privateVoiceId]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("UNIQUE")) throw err;
      // already registered — fine
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForVerificationLink(signupId: number): Promise<string> {
  const deadline = Date.now() + VERIFY_LINK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (cancelRequested) throw new Error("automation cancelled");
    const fresh = queryOne<SignupRow>("SELECT * FROM signups WHERE id = ?", [signupId]);
    if (fresh?.verification_link) return fresh.verification_link;
    await sleep(VERIFY_LINK_POLL_MS);
  }
  throw new Error("verification email did not arrive within 5 minutes");
}

async function openContext(): Promise<BrowserContext> {
  // The cached browser can become disconnected when the interactive signup
  // window is closed (or crashes). isConnected() catches that — relaunch.
  if (!browser || !browser.isConnected()) {
    const { chromium } = await import("playwright");
    // Headed: real browser fingerprint dodges hCaptcha invisible challenges
    // that block headless Chromium during EL's onboarding wizard.
    browser = await chromium.launch({
      headless: false,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
  return browser.newContext();
}

function setStatus(id: number, status: SignupRow["status"], step: string | null): void {
  runChanges(
    `UPDATE signups SET status = ?, automation_step = ?, automation_error = NULL WHERE id = ?`,
    [status, step, id]
  );
}

function setStep(id: number, step: string): void {
  runChanges(`UPDATE signups SET automation_step = ? WHERE id = ?`, [step, id]);
}

function markFailed(id: number, error: string): void {
  runChanges(
    `UPDATE signups SET status = 'failed', automation_step = NULL, automation_error = ? WHERE id = ?`,
    [error, id]
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Interactive signup — launches a *visible* (headed) Chromium with a fresh
// context (no cookies = no existing EL session) and pre-fills email +
// password. User clicks Sign Up themselves to dodge bot-detection on submit.
// Browser stays open until user closes the window.
// ---------------------------------------------------------------------------

export async function openInteractiveSignup(signupId: number): Promise<void> {
  console.log(`[interactive ${signupId}] start`);
  const row = queryOne<SignupRow>("SELECT * FROM signups WHERE id = ?", [signupId]);
  if (!row) throw new Error(`signup ${signupId} not found`);
  if (!row.password) throw new Error("signup row has no stored password");

  console.log(`[interactive ${signupId}] decrypting password`);
  const password = decrypt(row.password);

  // Use the shared browser (single instance reused across interactive +
  // worker). Worker picks up this exact page after IMAP catches verify, so
  // there's only ever one window per provision and session cookies survive.
  const ctx = await openContext();
  const page = await ctx.newPage();
  interactivePages.set(signupId, page);

  page.on("close", () => {
    console.log(`[interactive ${signupId}] page closed by user`);
    interactivePages.delete(signupId);
  });

  try {
    await page.goto("https://elevenlabs.io/app/sign-up", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[type="email"]', { state: "visible", timeout: 30_000 });
    await page.locator('input[type="email"]').first().fill(row.email);
    await page.locator('input[type="password"]').first().fill(password);

    // Click Sign Up. Exact text avoids the "Sign up with Google" SSO button.
    await page.getByRole("button", { name: /^sign ?up$/i }).first().click();

    // If hCaptcha surfaces, the visible window lets the user solve it manually.
  } catch (err) {
    console.error(`[interactive signup ${signupId}] failed:`, err);
    // Leave the page open so the user can finish manually.
  }
}

export async function shutdown(): Promise<void> {
  cancelRequested = true;
  if (activeContext) {
    try { await activeContext.close(); } catch { /* ignore */ }
  }
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
    browser = null;
  }
}
