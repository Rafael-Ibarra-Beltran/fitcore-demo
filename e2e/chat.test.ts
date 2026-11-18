// Widget de chat. Requiere núcleo (:3000), IA (:8000) con LLM_FAKE=1, landing (:4321) y panel (:5173) corriendo, y red (Turnstile en la landing).
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Browser, Page } from "playwright-core";
import { a11y, ADMIN, collectErrors, LANDING, launch, loginDemo } from "./helpers";

const SHOTS = process.env.SHOTS_DIR;
let browser: Browser;
beforeAll(async () => { browser = await launch(); });
afterAll(async () => { await browser.close(); });

const shot = (page: Page, name: string) => SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : Promise.resolve(null);

async function conversa(page: Page, tag: string) {
  const errors = collectErrors(page);
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Abrir chat con el asistente" }).click();
  await dialog.waitFor();
  await page.waitForTimeout(1200); // que terminen las animaciones de entrada antes de medir contraste
  await shot(page, `${tag}-1-abierto`);
  expect(await a11y(page)).toEqual([]);
  // Sugerencia -> tarjeta de clases
  await dialog.getByRole("button", { name: "¿Qué clases hay hoy?" }).click();
  await dialog.getByRole("list", { name: "Clases disponibles" }).waitFor({ timeout: 30_000 });
  await dialog.getByText("¿Algo más del gimnasio?").waitFor();
  await shot(page, `${tag}-2-clases`);
  // Fuera de tema -> rechazo con tarjeta, sin escalar
  await dialog.getByRole("textbox", { name: "Escribe tu mensaje" }).fill("dame una receta de pastel");
  await dialog.getByRole("button", { name: "Enviar mensaje" }).click();
  await dialog.getByText("Solo atiendo temas del gimnasio").waitFor({ timeout: 30_000 });
  await shot(page, `${tag}-3-fuera-de-tema`);
  expect(await dialog.getByText("Un asesor te contactará").count()).toBe(0);
  await page.waitForTimeout(800); // la tarjeta entra con un fundido: medir contraste a media animación da falsos positivos
  expect(await a11y(page)).toEqual([]);
  // Persiste al recargar (sessionStorage) y Esc cierra
  await page.reload();
  await page.getByRole("button", { name: "Abrir chat con el asistente" }).click();
  await page.getByRole("dialog").getByRole("list", { name: "Clases disponibles" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" }); // el <dialog> queda en el DOM con display:none
  expect(errors.filter((e) => !e.includes("challenges.cloudflare"))).toEqual([]);
}

for (const [name, viewport] of [["escritorio", { width: 1440, height: 900 }], ["celular", { width: 390, height: 844 }]] as const) {
  test(`landing ${name}: el chat responde con tarjetas, rechaza lo ajeno al gimnasio y es accesible`, async () => {
    const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500 });
    const page = await ctx.newPage();
    await page.goto(LANDING);
    await page.locator("h1").waitFor();
    await conversa(page, `landing-${name}`);
    await ctx.close();
  }, 90_000);
}

test("panel: el chat funciona con la sesión del panel, sin Turnstile", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginDemo(page);
  await conversa(page, "admin-escritorio");
  expect(page.url().startsWith(ADMIN)).toBe(true);
  await ctx.close();
}, 90_000);
