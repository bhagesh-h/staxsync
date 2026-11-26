import { expect, test, type Page } from "@playwright/test";

const CHIP_PAPER = /Clonal hematopoiesis of indeterminate potential/;
const EWAS_PAPER = /Epigenome-wide DNA methylation association study/;

async function openLibrary(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("link", { name: CHIP_PAPER })).toBeVisible();
  await expect(page.getByRole("link", { name: EWAS_PAPER })).toBeVisible();
}

async function openPaper(page: Page) {
  await openLibrary(page);
  await page.getByRole("link", { name: CHIP_PAPER }).click();
  await expect(page.getByTestId("page-count")).toHaveText("of 16");
  await expect(page.locator('.page[data-page-number="1"] canvas')).toBeVisible();
  await expect(page.locator('.page[data-page-number="1"] .textLayer span').first()).toBeAttached();
}

/** Selects the text of the first long span on page 1, as a person would by dragging. */
async function selectTextOnFirstPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll<HTMLElement>('.page[data-page-number="1"] .textLayer span'));
    // Plain text nothing sits on top of (the page's links are in a layer above the text).
    const span = spans.find((s) => {
      if ((s.textContent ?? "").trim().length < 30 || s.firstChild?.nodeType !== Node.TEXT_NODE) return false;
      const r = s.getBoundingClientRect();
      return r.width > 0 && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === s;
    });
    if (!span || !span.firstChild) throw new Error("no text span");
    const range = document.createRange();
    range.setStart(span.firstChild, 0);
    range.setEnd(span.firstChild, span.firstChild.textContent!.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    return range.toString();
  });
}

async function pageBox(page: Page) {
  const box = await page.locator('.page[data-page-number="1"]').boundingBox();
  if (!box) throw new Error("page 1 not laid out");
  return box;
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8);
  await page.mouse.up();
}

/** Computed font sizes of all interface text (not the PDF pages), plus the wordmark's size. */
async function textSizes(page: Page) {
  return page.evaluate(() => {
    const sizes = new Set<string>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("#root *"))) {
      if (el.closest(".brand, .pdfViewer")) continue;
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim());
      if (hasText || el.matches("input, select, textarea")) sizes.add(getComputedStyle(el).fontSize);
    }
    const brand = document.querySelector(".brand");
    return { ui: [...sizes], brand: brand ? getComputedStyle(brand).fontSize : null };
  });
}

const overlay = (page: Page, kind: string) => page.locator(`.page[data-page-number="1"] .sx-overlay [data-kind="${kind}"]`);

test("library lists the example papers with their metadata and DOI, in Ubuntu", async ({ page }) => {
  await openLibrary(page);
  await expect(page.getByTestId("paper-row")).toHaveCount(2);
  await expect(page.getByText("Nature Communications").first()).toBeVisible();
  const doi = page.getByTestId("paper-doi").filter({ hasText: "10.1038/s41467-022-33093-3" });
  await expect(doi).toHaveAttribute("href", "https://doi.org/10.1038/s41467-022-33093-3");
  const ubuntu = await page.evaluate(async () => {
    await document.fonts.ready;
    return { family: getComputedStyle(document.body).fontFamily, loaded: document.fonts.check('16px "Ubuntu"') };
  });
  expect(ubuntu.family).toMatch(/^"?Ubuntu"?/);
  expect(ubuntu.loaded).toBe(true);

  // One text size everywhere; only the StaxSync wordmark is bigger.
  const sizes = await textSizes(page);
  expect(sizes.ui).toHaveLength(1);
  expect(parseFloat(sizes.brand!)).toBeGreaterThan(parseFloat(sizes.ui[0]!) * 1.5);
});

test("papers take several tags and the tag filter includes, excludes and matches all/any", async ({ page }) => {
  await openLibrary(page);
  const chip = page.getByTestId("paper-row").filter({ has: page.getByRole("link", { name: CHIP_PAPER }) });
  const ewas = page.getByTestId("paper-row").filter({ has: page.getByRole("link", { name: EWAS_PAPER }) });
  for (const [row, names] of [
    [chip, ["cardio", "methylation"]],
    [ewas, ["methylation"]],
  ] as const) {
    const input = row.getByRole("combobox", { name: /Add tag/ });
    for (const name of names) {
      await input.fill(name);
      await input.press("Enter");
    }
  }
  await expect(chip.getByTestId("paper-tag")).toHaveCount(2);

  const rail = page.getByRole("navigation", { name: "Filters" });
  await rail.getByRole("button", { name: /^cardio,/ }).click(); // include
  await expect(page.getByTestId("paper-row")).toHaveCount(1);
  await expect(chip).toBeVisible();

  await rail.getByRole("button", { name: /^cardio,/ }).click(); // exclude
  await expect(page.getByTestId("paper-row")).toHaveCount(1);
  await expect(ewas).toBeVisible();

  await rail.getByRole("button", { name: /^cardio,/ }).click(); // off
  await rail.getByRole("button", { name: /^methylation,/ }).click();
  await expect(page.getByTestId("paper-row")).toHaveCount(2);

  // Tags survive a reload.
  await page.reload();
  await expect(chip.getByTestId("paper-tag")).toHaveCount(2);
});

test("highlight a selection, comment on it, and find it again after reload", async ({ page }) => {
  await openPaper(page);
  const text = await selectTextOnFirstPage(page);
  await page.keyboard.press("h");
  await expect(overlay(page, "highlight")).toHaveCount(1);
  await expect(overlay(page, "highlight")).toHaveAttribute("data-color", "yellow");
  // A new highlight is not framed by a selection box.
  await expect(page.locator(".sx-overlay .sx-selection")).toHaveCount(0);
  await expect(page.getByTestId("reader-doi")).toHaveText("doi:10.1038/s41467-022-33093-3");

  // Clicking the highlight opens it for a comment.
  const hl = await overlay(page, "highlight").locator("polygon").first().boundingBox();
  await page.mouse.click(hl!.x + hl!.width / 2, hl!.y + hl!.height / 2);
  const popover = page.getByTestId("annotation-popover");
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "Colour blue" }).click();
  await expect(overlay(page, "highlight")).toHaveAttribute("data-color", "blue");
  await popover.getByRole("textbox", { name: "Comment" }).fill("Key definition");
  await popover.getByRole("button", { name: "Close" }).click();

  await page.reload();
  await expect(overlay(page, "highlight")).toHaveCount(1);
  await expect(overlay(page, "highlight")).toHaveAttribute("data-color", "blue");
  await page.getByRole("button", { name: /^Notes/ }).click();
  const item = page.getByTestId("sidebar-item").first();
  await expect(item).toContainText("Blue highlight");
  await expect(item).toContainText(text.replace(/\s+/g, " ").trim().slice(0, 15));
  await expect(item).toContainText("Key definition");
});

test("selected text stays a light tint: the text layer never shows a second copy of the words", async ({ page }) => {
  await openPaper(page);
  await selectTextOnFirstPage(page);
  const colours = await page.evaluate(() => {
    const span = window.getSelection()!.getRangeAt(0).startContainer.parentElement!;
    const sel = getComputedStyle(span, "::selection");
    return { text: getComputedStyle(span).color, selected: sel.color };
  });
  const invisible = /rgba\(0, 0, 0, 0\)|transparent/;
  expect(colours.text).toMatch(invisible);
  // Browsers that report ::selection styles must report it transparent too.
  if (colours.selected) expect(colours.selected).toMatch(invisible);
});

test("underline from the selection menu, then undo and redo", async ({ page }) => {
  await openPaper(page);
  await selectTextOnFirstPage(page);
  await page.keyboard.press("u");
  await expect(overlay(page, "underline")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(overlay(page, "underline")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(overlay(page, "underline")).toHaveCount(1);
});

test("area, note, pen and eraser tools", async ({ page }) => {
  await openPaper(page);
  const box = await pageBox(page);
  const at = (fx: number, fy: number): [number, number] => [box.x + box.width * fx, box.y + Math.min(box.height, 900) * fy];

  await page.getByRole("button", { name: "Area", exact: true }).click();
  await drag(page, at(0.2, 0.3), at(0.5, 0.45));
  await expect(overlay(page, "area")).toHaveCount(1);

  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await drag(page, at(0.2, 0.6), at(0.6, 0.62));
  await expect(overlay(page, "ink")).toHaveCount(1);

  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  await drag(page, at(0.4, 0.55), at(0.4, 0.68));
  await expect(overlay(page, "ink")).toHaveCount(0);
  await expect(overlay(page, "area")).toHaveCount(1);

  await page.getByRole("button", { name: "Note", exact: true }).click();
  const [nx, ny] = at(0.9, 0.2);
  await page.mouse.click(nx, ny);
  await expect(overlay(page, "note")).toHaveCount(1);
  // A note is a chat bubble (a path with a tail), not a box.
  await expect(overlay(page, "note").locator("path.sx-bubble")).toHaveCount(1);
  await expect(overlay(page, "note").locator("rect")).toHaveCount(0); // no box, and no selection frame
  await expect(page.getByTestId("annotation-popover")).toBeVisible();
});

test("number keys pick RGBY colours and highlight the selection in them", async ({ page }) => {
  await openPaper(page);
  const colours = ["red", "green", "blue", "yellow"];
  for (const [i, colour] of colours.entries()) {
    await selectTextOnFirstPage(page);
    await page.keyboard.press(String(i + 1));
    await expect(overlay(page, "highlight").nth(i)).toHaveAttribute("data-color", colour);
  }
  // The highlighter keeps the last colour picked.
  // Colours stay hidden until Highlight is clicked; then they drop down, with the current one checked.
  const colours_ = page.getByRole("menu", { name: "Highlight colour" });
  await expect(colours_).toHaveCount(0);
  await page.getByRole("button", { name: /^Highlight tool/ }).click();
  await expect(colours_.getByRole("menuitemradio", { name: /Yellow/ })).toHaveAttribute("aria-checked", "true");
  await colours_.getByRole("menuitemradio", { name: /Green/ }).click();
  await expect(colours_).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Highlight tool/ })).toHaveAccessibleName("Highlight tool, green");
  await selectTextOnFirstPage(page);
  await page.keyboard.press("h");
  await expect(overlay(page, "highlight").nth(4)).toHaveAttribute("data-color", "green");
});

test("find in document reports matches", async ({ page }) => {
  await openPaper(page);
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("searchbox", { name: "Find in document" }).fill("methylation");
  await expect(page.getByTestId("find-info")).toHaveText(/\d+ of \d+/);
  expect((await textSizes(page)).ui).toHaveLength(1);
});

test("a stylus drag with the Highlight tool snaps to the words under it", async ({ page }) => {
  await openPaper(page);
  await page.getByRole("button", { name: /^Highlight tool/ }).click();
  await page.getByRole("menuitemradio", { name: /Yellow/ }).click();
  // Browsers can't be driven with a real pen in CI, so send the pen pointer events a stylus produces.
  const snapped = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll<HTMLElement>('.page[data-page-number="1"] .textLayer span'));
    const span = spans.find((s) => {
      if ((s.textContent ?? "").trim().length < 30) return false;
      const r = s.getBoundingClientRect();
      return r.width > 0 && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === s;
    });
    if (!span) throw new Error("no text span");
    const r = span.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const fire = (type: string, x: number) =>
      document.elementFromPoint(x, y)!.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen", pressure: 0.6, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
    // Start and end mid-word: the highlight should still cover whole words.
    fire("pointerdown", r.left + r.width * 0.12);
    for (let i = 1; i <= 6; i++) fire("pointermove", r.left + r.width * (0.12 + 0.1 * i));
    fire("pointerup", r.left + r.width * 0.72);
    return span.textContent ?? "";
  });
  await expect(overlay(page, "highlight")).toHaveCount(1);
  await page.getByRole("button", { name: /^Notes/ }).click();
  const quote = (await page.getByTestId("sidebar-item").first().locator(".ann-quote").innerText()).trim();
  // Whole words: the quote starts and ends on word boundaries of the span's text.
  const words = snapped.split(/\s+/);
  expect(words.some((w) => quote.startsWith(w))).toBe(true);
  expect(words.some((w) => quote.endsWith(w))).toBe(true);
  expect(quote.length).toBeGreaterThan(5);
});

test("read mode hides the toolbars and comes back", async ({ page }) => {
  await openPaper(page);
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "Annotation tools" })).toHaveCount(0);
  await page.getByRole("button", { name: "Exit read mode" }).click();
  await expect(page.getByRole("toolbar", { name: "Annotation tools" })).toBeVisible();
});
