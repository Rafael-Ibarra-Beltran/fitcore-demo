// Humo de la landing. Requiere el núcleo (:3000) y la landing (:4321) corriendo, y red (el formulario usa Turnstile).
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Browser } from "playwright-core";
import { a11y, collectErrors, CORE, LANDING, launch, SERVICE_KEY } from "./helpers";

let browser: Browser;
beforeAll(async () => { browser = await launch(); });
afterAll(async () => { await browser.close(); });

for (const [name, viewport] of [["escritorio", { width: 1440, height: 900 }], ["celular", { width: 390, height: 844 }]] as const) {
  test(`landing ${name}: sin errores, sin violaciones de accesibilidad y sin desbordamiento horizontal`, async () => {
    const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500 });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await page.goto(LANDING);
    await page.locator("h1").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1200);
    expect(await a11y(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 40_000);
}

test("el formulario crea un lead que luego aparece en la API", async () => {
  const page = await browser.newPage();
  const phone = `55${Date.now().toString().slice(-8)}`; // único por corrida
  await page.goto(LANDING);
  await page.getByRole("textbox", { name: "Nombre" }).fill("Prueba E2E");
  await page.getByRole("textbox", { name: "WhatsApp" }).fill(phone);
  await page.getByRole("button", { name: "Quiero mi clase de prueba" }).click();
  await page.getByText("¡Gracias!").waitFor({ timeout: 15_000 });
  const headers = { "x-service-key": SERVICE_KEY };
  const leads: { id: string; phone: string }[] = await (await fetch(`${CORE}/api/leads?phone=${phone}`, { headers })).json();
  try {
    expect(leads.length).toBe(1);
  } finally {
    for (const l of leads) await fetch(`${CORE}/api/leads/${l.id}`, { method: "DELETE", headers }); // no ensucia el demo
  }
  await page.close();
}, 40_000);

test("el formulario valida el teléfono sin enviar nada", async () => {
  const page = await browser.newPage();
  await page.goto(LANDING);
  await page.getByRole("textbox", { name: "Nombre" }).fill("Prueba E2E");
  await page.getByRole("textbox", { name: "WhatsApp" }).fill("123");
  await page.getByRole("button", { name: "Quiero mi clase de prueba" }).click();
  await page.getByRole("alert").waitFor({ timeout: 5_000 });
  expect(await page.getByText("¡Gracias!").count()).toBe(0);
  await page.close();
});
