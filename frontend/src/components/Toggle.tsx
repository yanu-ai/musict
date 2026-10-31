type ToggleProps = {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}

export function Toggle({ label, checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="neu-inset relative h-6 w-11 rounded-full">
        <span
          className={`neu-metal absolute top-1/2 size-5 -translate-y-1/2 rounded-full transition-all ${checked ? 'left-[22px]' : 'left-[2px]'}`}
        />
      </span>
      <span
        className={`size-1.5 rounded-full transition-colors ${checked ? 'bg-accent shadow-[0_0_6px_#7fe0d0]' : 'bg-faint'}`}
      />
    </button>
  )
}
