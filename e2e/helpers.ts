import { chromium, type Browser, type Page } from "playwright-core";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const ADMIN = process.env.ADMIN_URL ?? "http://localhost:5173";
export const LANDING = process.env.LANDING_URL ?? "http://localhost:4321";
export const CORE = process.env.CORE_URL ?? "http://localhost:3000";
export const SERVICE_KEY = process.env.SERVICE_KEY ?? "dev-service-key";
export const PASSWORD = process.env.DEMO_PASSWORD ?? "demo-fitcore-2026";

/** Chromium de Playwright ya descargado (bunx playwright install chromium), o el indicado en CHROMIUM_PATH. */
function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(process.env.HOME ?? "", ".cache/ms-playwright");
  if (!existsSync(cache)) return undefined;
  const dir = readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().at(-1);
  const exe = dir && join(cache, dir, "chrome-linux64/chrome");
  return exe && existsSync(exe) ? exe : undefined;
}

export const launch = (): Promise<Browser> => chromium.launch({ headless: true, executablePath: chromiumPath() });

/** Errores que la página emite: de consola, excepciones y respuestas 4xx/5xx. */
export function collectErrors(page: Page): string[] {
  const out: string[] = [];
  page.on("console", (m) => m.type() === "error" && out.push(`console: ${m.text().slice(0, 160)}`));
  page.on("pageerror", (e) => out.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on("response", (r) => r.status() >= 400 && out.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 100)}`));
  return out;
}

/** Violaciones de accesibilidad (axe-core) de la página actual. */
export async function a11y(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async () => {
    // @ts-expect-error axe lo inyecta addScriptTag
    const r = await axe.run(document, { resultTypes: ["violations"] });
    return r.violations.map((v: { id: string; nodes: { target: string[] }[] }) => `${v.id} ×${v.nodes.length} (${v.nodes[0].target.join(" ")})`);
  });
}

export async function loginDemo(page: Page) {
  await page.goto(`${ADMIN}/login`);
  await page.getByRole("button", { name: "Entrar como demo" }).click();
  await page.getByRole("heading", { name: "Resumen" }).waitFor({ timeout: 10_000 });
}

export async function loginStaff(page: Page) {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel("Correo").fill("staff@fitcore.test");
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("heading", { name: "Resumen" }).waitFor({ timeout: 10_000 });
}
