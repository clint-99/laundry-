import { chromium } from "playwright";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.goto(
    (process.env.TEST_BASE_URL || "http://127.0.0.1:3000") +
      "/icons/basket.svg",
  );
  for (const n of [192, 512]) {
    await page.setViewportSize({ width: n, height: n });
    await page.evaluate((n) => {
      document.documentElement.setAttribute("width", n);
      document.documentElement.setAttribute("height", n);
    }, n);
    await page.screenshot({
      path: `icons/icon-${n}.png`,
      omitBackground: true,
    });
  }
} finally {
  await browser.close();
}
