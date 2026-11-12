// Humo del panel. Requiere el núcleo (:3000) y el panel (:5173) corriendo y la base sembrada: bun run test:e2e
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Browser } from "playwright-core";
import { a11y, ADMIN, collectErrors, launch, loginDemo, loginStaff } from "./helpers";

let browser: Browser;
beforeAll(async () => { browser = await launch(); });
afterAll(async () => { await browser.close(); });

const SCREENS = ["/", "/socios", "/planes", "/membresias", "/pagos", "/clases", "/reservas", "/asistencia", "/leads", "/conocimiento", "/automatizaciones", "/conversaciones"];

test("dueño: cada pantalla carga sin errores y sin violaciones de accesibilidad", async () => {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = collectErrors(page);
  await loginDemo(page);
  const failures: string[] = [];
  for (const path of SCREENS) {
    await page.goto(ADMIN + path);
    await page.locator("h1").first().waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800); // deja terminar las consultas
    const v = await a11y(page);
    if (v.length) failures.push(`${path}: ${v.join("; ")}`);
  }
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
  await page.close();
}, 90_000);

test("recepción no ve pagos ni automatizaciones, ni entrando por URL", async () => {
  const page = await browser.newPage();
  await loginStaff(page);
  const nav = page.getByRole("navigation", { name: "Principal" });
  expect(await nav.getByRole("link", { name: "Pagos" }).count()).toBe(0);
  expect(await nav.getByRole("link", { name: "Automatizaciones" }).count()).toBe(0);
  await page.goto(`${ADMIN}/pagos`);
  await page.getByText("No tienes acceso a esta sección.").waitFor({ timeout: 10_000 });
  await page.goto(`${ADMIN}/automatizaciones`);
  await page.getByText("No tienes acceso a esta sección.").waitFor({ timeout: 10_000 });
  await page.close();
}, 40_000);

test("automatizaciones: ejecutar una tarea muestra su resultado", async () => {
  const page = await browser.newPage();
  await loginDemo(page);
  await page.goto(`${ADMIN}/automatizaciones`);
  await page.getByRole("button", { name: "Ejecutar: Vencimientos" }).click();
  await page.getByText(/destinatarios/).first().waitFor({ timeout: 10_000 });
  // El registro es de solo lectura: ni alta, ni edición, ni borrado, ni columna de acciones vacía.
  expect(await page.getByRole("button", { name: /^(Nuevo|Nueva|Editar|Eliminar)/ }).count()).toBe(0);
  expect(await page.getByRole("columnheader", { name: "Acciones" }).count()).toBe(0);
  await page.close();
}, 40_000);

test("el panel entra y sale: sin sesión redirige al login", async () => {
  const page = await browser.newPage();
  await page.goto(`${ADMIN}/socios`);
  await page.getByRole("button", { name: "Entrar como demo" }).waitFor({ timeout: 10_000 });
  await page.close();
});
