import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const report = JSON.parse(
  await readFile(
    new URL("../artifacts/smoke-report.json", import.meta.url),
    "utf8",
  ),
);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [];
try {
  const wide = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
  });
  const page = await wide.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${report.alicePort}`);
  await page.getByText("团队空间", { exact: true }).first().click();
  await page.getByText("Platform team", { exact: true }).waitFor();
  await page.getByText("查看对话与分支", { exact: true }).first().waitFor();
  await page.screenshot({ path: "artifacts/team-desktop-light.png" });
  await page.getByText("查看对话与分支", { exact: true }).first().click();
  await page.getByText(/只读/).waitFor();
  assert.equal(
    await page.getByRole("textbox").count(),
    0,
    "Team reader has no input for the source agent",
  );
  await page.screenshot({ path: "artifacts/conversation-readonly.png" });
  await page.getByText("从历史创建分支", { exact: true }).click();
  await page
    .getByRole("button", { name: /第 1 轮/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Example 1", exact: true }).click();
  await page.screenshot({ path: "artifacts/fork-desktop.png" });
  await page.getByText("创建并打开我的分支", { exact: true }).click();
  await page
    .getByText("创建并打开我的分支", { exact: true })
    .waitFor({ state: "hidden", timeout: 20_000 });
  await page.getByRole("textbox").last().waitFor({ timeout: 20_000 });
  await wide.close();
  const compact = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
  });
  const phone = await compact.newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto(`http://127.0.0.1:${report.alicePort}`);
  await phone.getByRole("button", { name: "Open menu", exact: true }).click();
  await phone.getByText("团队空间", { exact: true }).first().click();
  await phone.getByText("Platform team", { exact: true }).waitFor();
  await phone.getByText("查看对话与分支", { exact: true }).first().waitFor();
  await phone.screenshot({ path: "artifacts/team-mobile-dark.png" });
  assert.ok(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "No page-wide horizontal overflow",
  );
  await phone.getByText("我的 Agent", { exact: true }).click();
  await phone.getByText("加入团队", { exact: true }).first().waitFor();
  await phone.screenshot({ path: "artifacts/local-mobile-dark.png" });
  await compact.close();
  const betaContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
  });
  const beta = await betaContext.newPage();
  beta.on("pageerror", (error) => errors.push(error.message));
  await beta.goto(`http://127.0.0.1:${report.bobPort}`, {
    waitUntil: "domcontentloaded",
  });
  await beta.getByText("团队空间", { exact: true }).first().click();
  await beta.getByText("Platform team", { exact: true }).waitFor();
  await beta.getByText("查看对话与分支", { exact: true }).first().waitFor();
  await beta.screenshot({ path: "artifacts/team-beta.png" });
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/browser-report.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks: [
          "desktop light team view",
          "read-only source has no composer",
          "fork form",
          "fork created through UI",
          "compact dark team view",
          "compact local sharing view",
          "beta client team view",
          "no horizontal overflow",
          "no uncaught page errors",
        ],
        nativeDeviceTested: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "Browser checks passed: desktop/light, compact/dark, read-only conversation, UI fork, no page errors",
  );
} finally {
  await browser.close();
}
