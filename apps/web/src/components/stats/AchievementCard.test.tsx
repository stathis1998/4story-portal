import type { Achievement } from '@4story-portal/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { achievement, level, simple } from '../../test/achievements'
import { AchievementCard } from './AchievementCard'

function show(shown: Achievement = achievement()) {
  render(
    <ul>
      <AchievementCard achievement={shown} players={5} />
    </ul>,
  )
  return screen.getByRole('button', { name: new RegExp(`^${shown.name}`) })
}

const bar = () => screen.getByRole('progressbar')

describe('AchievementCard', () => {
  it('sums the achievement up while closed: level, progress, next goal and its reward', () => {
    const header = show()

    expect(header).toHaveAttribute('aria-haspopup', 'dialog')
    expect(header).toHaveTextContent('View levels')
    expect(header).toHaveTextContent('Level 2/5')
    expect(header).toHaveTextContent('7,420 / 10,000')
    expect(header).toHaveTextContent('Next: Defeat 10,000 monsters')
    expect(bar()).toHaveAttribute('aria-valuenow', '74')
    expect(screen.getByRole('img', { name: 'Rune' }).parentElement).toHaveTextContent('5')
    expect(screen.getByRole('img', { name: 'Cron' }).parentElement).toHaveTextContent('250')
    expect(screen.queryByRole('img', { name: 'Luna' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Small Potion' })).toHaveAttribute('src', '/game-icons/12.png')
    expect(screen.getByText('x3')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(header).not.toHaveClass('border-dashed')
    expect(screen.getByRole('listitem')).not.toHaveClass('opacity-60')
  })

  it('leaves the reward out when the next level pays nothing', () => {
    const header = show(achievement({ value: 20_000, valueText: '20,000', levelsDone: 3, levels: achievement().levels.map((l) => ({ ...l, done: l.level <= 3 })) }))

    expect(header).toHaveTextContent('20,000 / 50,000')
    expect(header).toHaveTextContent('Next: Defeat 50,000 monsters')
    expect(header).not.toHaveTextContent('Reward')
  })

  it('writes the threshold the way the API wrote it', () => {
    const smith = show(
      achievement({ name: 'Blacksmith', value: 22, valueText: '+22', levelsDone: 0, levels: [level({ threshold: 24, thresholdText: '+24', goal: 'Upgrade an item to +24' })] }),
    )
    expect(smith).toHaveTextContent('+22 / +24')
  })

  it('keeps a shortened value and its threshold in the same unit', () => {
    const hitter = show(
      achievement({ name: 'Heavy Hitter', value: 81_300_000, valueText: '81.3M', levelsDone: 0, levels: [level({ threshold: 100_000_000, thresholdText: '100M', goal: 'Deal 100M damage to monsters' })] }),
    )
    expect(hitter).toHaveTextContent('81.3M / 100M')
  })

  it('looks clickable: it changes on hover', () => {
    const header = show()
    expect(header).toHaveClass('cursor-pointer', 'hover:border-accent')
  })

  it('opens a pop-up with every level, instead of growing in place', async () => {
    const header = show()
    await userEvent.click(header)

    const dialog = screen.getByRole('dialog', { name: 'Slayer' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // Outside the card, so the cards under it stay where they are.
    expect(header.closest('li')!.contains(dialog)).toBe(false)
    expect(dialog).toHaveTextContent('Combat')
    expect(dialog).toHaveTextContent('Level 2/5')

    const levels = within(within(dialog).getByRole('list', { name: 'Slayer levels' })).getAllByRole('listitem')
    expect(levels).toHaveLength(5)
    expect(levels[0]).toHaveTextContent('Slayer I')
    expect(levels[0]).toHaveTextContent('Defeat 100 monsters')
    expect(levels[0]).toHaveTextContent('Earned 9 Nov')
    expect(levels[0]).toHaveTextContent('Reached by Aki, Bo, Cy and Dee')
    expect(levels[0]).toHaveTextContent('4 of 5 players')
    // Done before rewards went live, so there is no date.
    expect(levels[1]).toHaveTextContent('Slayer II')
    expect(levels[1]).toHaveTextContent('Done')
    expect(levels[1]).not.toHaveTextContent('Earned')
    expect(levels[4]).toHaveTextContent('Slayer V')
    expect(levels[4]).toHaveTextContent('Nobody has reached this yet')
  })

  it('shows how far the level in progress is, with its reward written out', async () => {
    await userEvent.click(show())
    const levels = within(screen.getByRole('list', { name: 'Slayer levels' })).getAllByRole('listitem')

    expect(levels[2]).toHaveTextContent('Slayer III')
    expect(levels[2]).toHaveTextContent('In progress')
    expect(levels[2]).toHaveTextContent('7,420 / 10,000')
    expect(within(levels[2]).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '74')
    expect(levels[2]).toHaveTextContent('Small Potion')
    expect(levels[2]).toHaveTextContent('Reached by Aki')
    expect(levels[2]).toHaveTextContent('1 of 5 players')
    expect(levels[2]).not.toHaveTextContent('Done')
    // Only the level being worked on has a bar.
    expect(within(levels[3]).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(levels[3]).not.toHaveTextContent('In progress')
  })

  it('closes with its button, and puts the focus back on the card', async () => {
    const header = show()
    await userEvent.click(header)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(header).toHaveFocus()
  })

  it('closes with Escape, and with a click outside it', async () => {
    const header = show()
    await userEvent.click(header)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(header)
    await userEvent.click(screen.getByTestId('achievement-backdrop'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays open for a click inside it, and keeps Tab inside', async () => {
    await userEvent.click(show())
    await userEvent.click(screen.getByRole('list', { name: 'Slayer levels' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('stops the page behind it from scrolling while it is open', async () => {
    await userEvent.click(show())
    expect(document.body.style.overflow).toBe('hidden')
    await userEvent.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('')
  })

  it('says Not done for a single level, dashed and dim until it is started', async () => {
    const header = show(simple('ouch', 'Ouch', 0))

    expect(header).toHaveTextContent('Not done')
    expect(header).not.toHaveTextContent('Level')
    expect(header).toHaveTextContent('0 / 100')
    expect(header).toHaveClass('border-dashed')
    expect(screen.getByRole('listitem')).toHaveClass('opacity-60')

    await userEvent.click(header)
    const dialog = screen.getByRole('dialog', { name: 'Ouch' })
    // The pop-up is not dimmed with the card.
    expect(dialog.closest('.opacity-60')).toBeNull()
    const [only] = within(within(dialog).getByRole('list', { name: 'Ouch levels' })).getAllByRole('listitem')
    expect(only).toHaveTextContent('Reach 100 for Ouch')
    expect(only).toHaveTextContent('Nobody has reached this yet')
    // No numeral: the level is just the achievement.
    expect(only).not.toHaveTextContent('Ouch I')
  })
  it('says Done for a single level that is done', () => {
    const header = show(simple('ouch', 'Ouch', 100))

    expect(header).toHaveTextContent('Done')
    expect(header).not.toHaveTextContent('Not done')
    expect(header).toHaveTextContent('Completed')
  })

  it('shows Completed and a full bar when every level is done', () => {
    const header = show(
      achievement({ value: 123_456, valueText: '123,456', levelsDone: 5, levels: achievement().levels.map((l) => ({ ...l, done: true })) }),
    )

    expect(header).toHaveTextContent('Level 5/5')
    expect(header).toHaveTextContent('Completed')
    expect(header).toHaveTextContent('123,456')
    expect(header).not.toHaveTextContent('Next:')
    expect(header).not.toHaveTextContent('/ ')
    expect(bar()).toHaveAttribute('aria-valuenow', '100')
  })
})
