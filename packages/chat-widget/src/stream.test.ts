import { expect, test } from "bun:test";
import { readEvents } from "./stream";

const body = (...parts: string[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); },
});
const collect = async (b: ReadableStream<Uint8Array>) => { const out = []; for await (const e of readEvents(b)) out.push(e); return out; };

test("un evento partido entre dos trozos de red se reconstruye completo", async () => {
  const ev = await collect(body('event: tok', 'en\ndata: {"text": "Ho', 'la"}\n\nevent: done\ndata: {"conversationId": "c", "escalated": false}\n\n'));
  expect(ev).toEqual([{ event: "token", data: { text: "Hola" } }, { event: "done", data: { conversationId: "c", escalated: false } }]);
});

test("un carácter multibyte partido entre trozos no se corrompe", async () => {
  const bytes = new TextEncoder().encode('event: token\ndata: {"text": "ñ"}\n\n');
  const cut = bytes.indexOf(0xc3) + 1; // la ñ ocupa 2 bytes: se corta en medio
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, cut)); c.enqueue(bytes.slice(cut)); c.close(); } });
  expect(await collect(stream)).toEqual([{ event: "token", data: { text: "ñ" } }]);
});

test("ignora bloques corruptos o que no cumplen el esquema y sigue con el resto", async () => {
  const ev = await collect(body('event: token\ndata: {roto\n\nevent: raro\ndata: {}\n\nevent: token\ndata: {"text": "ok"}\n\n'));
  expect(ev).toEqual([{ event: "token", data: { text: "ok" } }]);
});
