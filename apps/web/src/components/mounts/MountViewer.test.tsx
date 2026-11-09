import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MountViewer from './MountViewer'

describe('MountViewer', () => {
  it('says so when the browser has no WebGL', () => {
    render(<MountViewer src="/mount-models/1.glb" name="Horse" />)

    expect(screen.getByText('Your browser cannot show 3D models.')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '3D model of Horse' })).toBeInTheDocument()
  })
})
