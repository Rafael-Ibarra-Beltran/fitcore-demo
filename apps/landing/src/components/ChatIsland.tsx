import { ChatWidget } from '@fitcore/chat-widget'
import '@fitcore/chat-widget/styles.css'

const CORE = (import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const AI = (import.meta.env.PUBLIC_AI_URL ?? 'http://localhost:8000').replace(/\/$/, '')
const SITEKEY = import.meta.env.PUBLIC_TURNSTILE_SITEKEY ?? '1x00000000000000000000AA'

export default function ChatIsland({ whatsapp }: { whatsapp?: string }) {
  return <ChatWidget coreUrl={CORE} aiUrl={AI} whatsapp={whatsapp} turnstileSiteKey={SITEKEY} />
}
