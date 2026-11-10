import { screen } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'

/** Opens a header group and follows one of its links. */
export async function clickNav(user: UserEvent, group: 'Rankings' | 'Tools', link: string) {
  await user.click(await screen.findByRole('button', { name: group }))
  await user.click(screen.getByRole('link', { name: link }))
}
