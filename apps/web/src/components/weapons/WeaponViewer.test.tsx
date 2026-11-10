import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import WeaponViewer from './WeaponViewer'

describe('WeaponViewer', () => {
  it('says so when the browser has no WebGL', () => {
    render(<WeaponViewer itemId={7625} skinId={null} layer={null} name="Sword of Dawn" />)

    expect(screen.getByText('Your browser cannot show 3D models.')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '3D model of Sword of Dawn' })).toBeInTheDocument()
  })
})
