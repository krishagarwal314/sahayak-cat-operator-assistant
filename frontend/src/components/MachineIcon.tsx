/** Line-art silhouettes so each machine family is recognisable at a glance. */
export function MachineIcon({ family, className = 'h-10 w-10' }: { family: string; className?: string }) {
  const common = {
    className,
    viewBox: '0 0 64 40',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  if (family === 'loader') {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="20" y="14" width="20" height="12" rx="2" />
        <path d="M26 14V8h9l3 6" />
        <path d="M40 18l11-5 5 9v6" />
        <path d="M56 28h-5" />
        <circle cx="25" cy="31" r="5" />
        <circle cx="43" cy="31" r="5" />
        <path d="M20 22H9" />
        <path d="M9 16v12l-5-2" />
      </svg>
    )
  }

  if (family === 'dozer') {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="22" y="12" width="18" height="11" rx="2" />
        <path d="M27 12V7h9l3 5" />
        <rect x="16" y="26" width="32" height="8" rx="4" />
        <path d="M22 26v8M30 26v8M38 26v8" />
        <path d="M12 10v24" />
        <path d="M12 16l9 3M12 28l9-3" />
      </svg>
    )
  }

  // excavator
  return (
    <svg {...common} aria-hidden="true">
      <rect x="10" y="14" width="18" height="12" rx="2" />
      <path d="M15 14V8h8l3 6" />
      <rect x="6" y="28" width="28" height="7" rx="3.5" />
      <path d="M12 28v7M20 28v7M28 28v7" />
      <path d="M28 17l14-9" />
      <path d="M42 8l8 12" />
      <path d="M50 20l-3 6h-8l2-6z" />
    </svg>
  )
}
