import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MOUNTS } from '../lib/mounts-chakras'
import { PETS } from '../lib/pets'
import { mockApi } from '../test/mock-api'
import { clickNav } from '../test/nav'
import { renderRoute } from '../test/render-route'

// WebGL doesn't exist in the test environment.
vi.mock('../components/mounts/MountViewer', () => ({
  default: ({ src, name }: { src: string; name: string }) => <div role="img" aria-label={`3D model of ${name}`} data-src={src} />,
}))

const me = { userId: 1, username: 'friend', isGm: false }

/** A mount card's name runs straight into its durations, and some names start with another mount's name. */
const mountButton = (name: string) => new RegExp(String.raw`^${name}\s*(Permanent|\d)`)
/** A pet card's name runs straight into its rune names, and some pet names start with another pet's name. */
const petButton = (name: string) => new RegExp(String.raw`^${name}(?=[A-Z])`)

const open = async () => {
  mockApi()
  const rendered = renderRoute('/mounts-pets', { me })
  await screen.findByRole('heading', { name: 'Mounts & Pets', level: 1 })
  return rendered
}

const mountPreview = () => screen.getByRole('complementary', { name: 'Mount preview' })
const petPreview = () => screen.getByRole('complementary', { name: 'Pet preview' })

describe('mounts and pets page', () => {
  it('is linked from the header', async () => {
    mockApi()
    const { user, router } = renderRoute('/characters', { me })

    await clickNav(user, 'Tools', 'Mounts & Pets')

    await waitFor(() => expect(router.state.location.pathname).toBe('/mounts-pets'))
    expect(await screen.findByRole('heading', { name: 'Mounts & Pets', level: 1 })).toBeInTheDocument()
  })

  it('sends visitors who are not logged in to the login page', async () => {
    mockApi()
    const { router } = renderRoute('/mounts-pets', { me: null })

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('takes old links to the mounts and chakras page here', async () => {
    mockApi()
    const { router } = renderRoute('/mounts-chakras', { me })

    await waitFor(() => expect(router.state.location.pathname).toBe('/mounts-pets'))
    expect(await screen.findByRole('heading', { name: 'Mounts & Pets', level: 1 })).toBeInTheDocument()
  })

  describe('mounts', () => {
    it('lists every mount once, with the durations it comes in', async () => {
      await open()

      const list = screen.getByRole('list', { name: 'Mounts' })
      expect(within(list).getAllByRole('listitem')).toHaveLength(MOUNTS.length)
      expect(within(list).getAllByText('Black Buffalo')).toHaveLength(1)

      const blackBuffalo = within(list).getByText('Black Buffalo').closest('li') as HTMLElement
      expect(blackBuffalo).toHaveTextContent('Permanent')
      expect(blackBuffalo).toHaveTextContent('30 days')
    })

    it('starts by showing the first mount that has a model', async () => {
      await open()

      const first = MOUNTS.find((mount) => mount.model !== null)!
      expect(await within(mountPreview()).findByRole('img', { name: `3D model of ${first.name}` })).toHaveAttribute(
        'data-src',
        `/mount-models/${first.model}.glb`,
      )
      expect(screen.getByRole('button', { name: mountButton(first.name), pressed: true })).toBeInTheDocument()
    })

    it('shows the model of the mount you pick', async () => {
      const { user } = await open()
      const picked = MOUNTS.filter((mount) => mount.model !== null)[1]

      await user.click(screen.getByRole('button', { name: mountButton(picked.name) }))

      expect(await within(mountPreview()).findByRole('img', { name: `3D model of ${picked.name}` })).toHaveAttribute(
        'data-src',
        `/mount-models/${picked.model}.glb`,
      )
      expect(screen.getByRole('button', { name: mountButton(picked.name), pressed: true })).toBeInTheDocument()
    })

    it('shows the item icon when there is one', async () => {
      await open()

      const withIcon = MOUNTS.find((mount) => mount.icon !== null)
      const row = within(screen.getByRole('list', { name: 'Mounts' })).getByText(withIcon!.name).closest('li') as HTMLElement
      expect(row.querySelector('img')).toHaveAttribute('src', `/game-icons/${withIcon!.icon}.png`)
    })
  })

  describe('pets', () => {
    it('lists every pet once, with the runes that summon it', async () => {
      await open()

      const list = screen.getByRole('list', { name: 'Pets' })
      expect(within(list).getAllByRole('listitem')).toHaveLength(PETS.length)
      expect(within(list).getAllByText('Suckling')).toHaveLength(1)
      const zombieDragon = within(list).getByText('Zombie Dragon').closest('li') as HTMLElement
      expect(zombieDragon).toHaveTextContent('Companion Rune')
      expect(zombieDragon).toHaveTextContent('Zombie Dragon Rune')
    })

    it('starts by showing the first pet, beside the mount preview', async () => {
      await open()

      const [first] = PETS
      expect(await within(petPreview()).findByRole('img', { name: `3D model of ${first.name}` })).toHaveAttribute(
        'data-src',
        `/pet-models/${first.looks[0]}.glb`,
      )
      expect(screen.getByRole('button', { name: petButton(first.name), pressed: true })).toBeInTheDocument()
      expect(await within(mountPreview()).findByRole('img')).toBeInTheDocument()
    })

    it('shows the model of the pet you pick', async () => {
      const { user } = await open()

      await user.click(screen.getByRole('button', { name: petButton('Titan') }))

      expect(await within(petPreview()).findByRole('img', { name: '3D model of Titan' })).toHaveAttribute('data-src', '/pet-models/31736.glb')
      expect(screen.getByRole('button', { name: petButton('Titan'), pressed: true })).toBeInTheDocument()
    })

    it('switches between the looks of a pet that comes in several', async () => {
      const { user } = await open()
      await user.click(screen.getByRole('button', { name: petButton('Suckling') }))
      expect(screen.getByRole('button', { name: 'Look 1', pressed: true })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Look 3' }))

      expect(await within(petPreview()).findByRole('img', { name: '3D model of Suckling' })).toHaveAttribute('data-src', '/pet-models/31144.glb')
      expect(screen.getByRole('button', { name: 'Look 3', pressed: true })).toBeInTheDocument()
    })

    it('starts each newly picked pet at its first look, and has no look buttons for a pet with one look', async () => {
      const { user } = await open()
      await user.click(screen.getByRole('button', { name: petButton('Crab') }))
      await user.click(screen.getByRole('button', { name: 'Look 2' }))

      await user.click(screen.getByRole('button', { name: petButton('Iron Lamb') }))
      expect(within(petPreview()).getByRole('img', { name: '3D model of Iron Lamb' })).toHaveAttribute('data-src', '/pet-models/31130.glb')

      await user.click(screen.getByRole('button', { name: petButton('Titan') }))
      expect(screen.queryByRole('button', { name: 'Look 1' })).not.toBeInTheDocument()
    })

    it('warns about pets whose rune does nothing on this server', async () => {
      await open()

      const list = screen.getByRole('list', { name: 'Pets' })
      const humptyDumpty = within(list).getByText('Humpty Dumpty').closest('li') as HTMLElement
      expect(humptyDumpty).toHaveTextContent(/not on this server/i)
      const titan = within(list).getByText('Titan').closest('li') as HTMLElement
      expect(titan).not.toHaveTextContent(/not on this server/i)
    })

    it('has a model file for every look, and no unused ones', () => {
      // Only the file names: nothing is loaded.
      const files = Object.keys(import.meta.glob('../../public/pet-models/*.glb')).map((file) => file.split('/').pop())

      expect(PETS.flatMap((pet) => pet.looks.map((look) => `${look}.glb`)).sort()).toEqual(files.sort())
    })

    it('shows the rune icon', async () => {
      await open()

      const row = within(screen.getByRole('list', { name: 'Pets' })).getByText('Spots').closest('li') as HTMLElement
      expect(row.querySelector('img')).toHaveAttribute('src', '/game-icons/12470.png')
    })
  })
})
