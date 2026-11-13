import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RewardEditor } from './RewardEditor'

function open(onSave = vi.fn()) {
  render(<RewardEditor name="Slayer II" reward={{ gold: 100, silver: 0, copper: 0, items: [] }} saving={false} error={null} onSave={onSave} onCancel={() => {}} />)
  return onSave
}

/** What a number input reports when the browser can't read what was typed, such as `1,000`. */
function typeUnreadable(input: HTMLElement) {
  Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: true } })
  fireEvent.change(input, { target: { value: '' } })
}

describe('RewardEditor', () => {
  it('saves a blank coin as 0', () => {
    const onSave = open()
    fireEvent.change(screen.getByLabelText('Luna'), { target: { value: '' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Reward for Slayer II' }))
    expect(onSave).toHaveBeenCalledWith({ gold: 100, silver: 0, copper: 0, items: [] })
  })

  it('refuses a coin the browser could not read as a number, instead of saving it as 0', () => {
    const onSave = open()
    typeUnreadable(screen.getByLabelText('Rune'))
    fireEvent.submit(screen.getByRole('form', { name: 'Reward for Slayer II' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Rune: Enter a whole number')).toBeInTheDocument()
  })

  it('saves again once the coin is a number', () => {
    const onSave = open()
    const rune = screen.getByLabelText('Rune')
    typeUnreadable(rune)
    Object.defineProperty(rune, 'validity', { configurable: true, value: { badInput: false } })
    fireEvent.change(rune, { target: { value: '250' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Reward for Slayer II' }))
    expect(onSave).toHaveBeenCalledWith({ gold: 250, silver: 0, copper: 0, items: [] })
  })
})