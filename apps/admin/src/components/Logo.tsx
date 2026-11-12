import { APP_NAME } from '@fitcore/shared'

export function Logo({ className = 'h-7 w-auto' }: { className?: string }) {
  return (
    <svg className={className} viewBox="4 6 56 52" fill="currentColor" role="img" aria-label={APP_NAME}>
      <path d="M6 8H26V15H13V28H22V35H13V56H6Z" />
      <path d="M58 11.5H39Q32 11.5 32 18.5V45.5Q32 52.5 39 52.5H58" fill="none" stroke="currentColor" strokeWidth="7" />
      <circle cx="46" cy="32" r="6.5" fill="var(--color-accent)" />
    </svg>
  )
}
