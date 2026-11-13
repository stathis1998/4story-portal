import type { ComponentProps } from 'react'

const variants = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary: 'border border-secondary/50 text-secondary hover:border-secondary hover:text-fg',
}

const sizes = {
  md: 'px-4 py-2',
  sm: 'px-3 py-1.5',
}

// ComponentProps rather than ButtonHTMLAttributes, so a caller can pass a ref to move the focus here.
type Props = ComponentProps<'button'> & { variant?: keyof typeof variants; size?: keyof typeof sizes }

export function Button({ variant = 'primary', size = 'md', type = 'button', className = '', ...props }: Props) {
  return (
    <button
      type={type}
      className={`rounded-xs text-sm font-bold tracking-wide transition outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  )
}
