import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({ viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p });
export const Chat = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-3.9A8 8 0 1 1 20 12Z" /><path d="M9 11h6M9 14h3.5" /></svg>;
export const Close = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>;
export const Send = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 12h13M12 5l7 7-7 7" /></svg>;
export const Stop = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)} fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
export const Copy = (p: SVGProps<SVGSVGElement>) => <svg {...base({ width: 16, height: 16, ...p })}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>;
export const Check = (p: SVGProps<SVGSVGElement>) => <svg {...base({ width: 16, height: 16, ...p })}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
export const Refresh = (p: SVGProps<SVGSVGElement>) => <svg {...base({ width: 16, height: 16, ...p })}><path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4" /></svg>;
export const Dumbbell = (p: SVGProps<SVGSVGElement>) => <svg {...base({ width: 16, height: 16, ...p })}><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" /></svg>;
export const Spark = (p: SVGProps<SVGSVGElement>) => <svg {...base({ width: 16, height: 16, ...p })}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></svg>;
