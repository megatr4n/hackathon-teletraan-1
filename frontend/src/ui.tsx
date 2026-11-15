import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { Slot } from '@radix-ui/react-slot'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

// shadcn/ui's component pattern, with variants styled for this console.
export function Button({ asChild, className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean; ref?: Ref<HTMLButtonElement> }) {
  const Component = asChild ? Slot : 'button'
  return <Component type={type} className={twMerge(clsx('button', className))} {...props} />
}

export function Segmented<T extends string>({ label, value, onChange, items, className }: {
  label: string
  value: T
  onChange: (value: T) => void
  items: { value: T; label: ReactNode }[]
  className?: string
}) {
  return <ToggleGroup.Root type="single" value={value} aria-label={label} className={clsx('segmented', className)}
    onValueChange={next => { if (next) onChange(next as T) }}>
    {items.map(item => <ToggleGroup.Item key={item.value} value={item.value} className="segment">{item.label}</ToggleGroup.Item>)}
  </ToggleGroup.Root>
}
