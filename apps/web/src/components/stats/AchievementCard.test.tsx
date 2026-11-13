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

    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(header).toHaveTextContent('Level 2/5')
    expect(header).toHaveTextContent('7,420 / 10,000')
    expect(header).toHaveTextContent('Next: Defeat 10,000 monsters')
    expect(bar()).toHaveAttribute('aria-valuenow', '74')
    expect(screen.getByRole('img', { name: 'Rune' }).parentElement).toHaveTextContent('5')
    expect(screen.getByRole('img', { name: 'Cron' }).parentElement).toHaveTextContent('250')
    expect(screen.queryByRole('img', { name: 'Luna' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Small Potion' })).toHaveAttribute('src', '/game-icons/12.png')
    expect(screen.getByText('x3')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Slayer levels' })).not.toBeInTheDocument()
    expect(screen.getByRole('listitem')).not.toHaveClass('border-dashed')
  })

  it('leaves the reward out when the next level pays nothing', () => {
    const header = show(achievement({ value: 20_000, valueText: '20,000', levelsDone: 3, levels: achievement().levels.map((l) => ({ ...l, done: l.level <= 3 })) }))

    expect(header).toHaveTextContent('20,000 / 50,000')
    expect(header).toHaveTextContent('Next: Defeat 50,000 monsters')
    expect(header).not.toHaveTextContent('Reward')
  })

  it('writes the threshold with a plus when the value has one', () => {
    const header = show(
      achievement({ name: 'Blacksmith', value: 22, valueText: '+22', levelsDone: 0, levels: [level({ threshold: 24, goal: 'Upgrade an item to +24' })] }),
    )

    expect(header).toHaveTextContent('+22 / +24')
  })

  it('lists every level when opened, and closes again', async () => {
    const header = show()
    await userEvent.click(header)

    expect(header).toHaveAttribute('aria-expanded', 'true')
    const levels = within(screen.getByRole('list', { name: 'Slayer levels' })).getAllByRole('listitem')
    expect(levels).toHaveLength(5)
    expect(levels[0]).toHaveTextContent('Slayer I')
    expect(levels[0]).toHaveTextContent('Defeat 100 monsters')
    expect(levels[0]).toHaveTextContent('Earned 9 Nov')
    expect(levels[0]).toHaveTextContent('4 of 5 players')
    // Done before rewards went live, so there is no date.
    expect(levels[1]).toHaveTextContent('Slayer II')
    expect(levels[1]).toHaveTextContent('Done')
    expect(levels[1]).not.toHaveTextContent('Earned')
    expect(levels[2]).toHaveTextContent('Slayer III')
    expect(levels[2]).toHaveTextContent('Small Potion')
    expect(levels[2]).toHaveTextContent('1 of 5 players')
    expect(levels[2]).not.toHaveTextContent('Done')
    expect(levels[4]).toHaveTextContent('Slayer V')
    expect(levels[4]).toHaveTextContent('0 of 5 players')

    await userEvent.click(header)
    expect(screen.queryByRole('list', { name: 'Slayer levels' })).not.toBeInTheDocument()
  })

  it('says Not done for a single level, dashed and dim until it is started', async () => {
    const header = show(simple('ouch', 'Ouch', 0))

    expect(header).toHaveTextContent('Not done')
    expect(header).not.toHaveTextContent('Level')
    expect(header).toHaveTextContent('0 / 100')
    expect(screen.getByRole('listitem')).toHaveClass('border-dashed', 'opacity-60')

    await userEvent.click(header)
    const [only] = within(screen.getByRole('list', { name: 'Ouch levels' })).getAllByRole('listitem')
    // No numeral: the level is just the achievement.
    expect(only).toHaveTextContent(/^OuchReach 100 for Ouch0 of 5 players$/)
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
