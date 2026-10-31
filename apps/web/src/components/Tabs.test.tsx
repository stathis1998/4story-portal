import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Tabs } from './Tabs'

const tabs = [
  { id: 'coords', label: 'Coordinates' },
  { id: 'character', label: 'Character' },
  { id: 'presets', label: 'Presets' },
]

describe('Tabs', () => {
  it('marks only the active tab as selected and tabbable', () => {
    render(<Tabs tabs={tabs} active="character" onChange={() => {}} />)

    expect(screen.getByRole('tab', { name: 'Character' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Coordinates' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Character' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Presets' })).toHaveAttribute('tabindex', '-1')
  })

  it('calls onChange when a tab is clicked', async () => {
    const onChange = vi.fn()
    render(<Tabs tabs={tabs} active="coords" onChange={onChange} />)

    await userEvent.click(screen.getByRole('tab', { name: 'Character' }))

    expect(onChange).toHaveBeenCalledWith('character')
  })

  it('wraps around from the last tab on ArrowRight and focuses the new tab', async () => {
    const onChange = vi.fn()
    render(<Tabs tabs={tabs} active="presets" onChange={onChange} />)

    screen.getByRole('tab', { name: 'Presets' }).focus()
    await userEvent.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenCalledWith('coords')
    expect(screen.getByRole('tab', { name: 'Coordinates' })).toHaveFocus()
  })

  it('wraps around from the first tab on ArrowLeft', async () => {
    const onChange = vi.fn()
    render(<Tabs tabs={tabs} active="coords" onChange={onChange} />)

    screen.getByRole('tab', { name: 'Coordinates' }).focus()
    await userEvent.keyboard('{ArrowLeft}')

    expect(onChange).toHaveBeenCalledWith('presets')
  })
})
