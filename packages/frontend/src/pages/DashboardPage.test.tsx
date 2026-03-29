import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import { DashboardPage } from './DashboardPage'

vi.mock('@/api/apps', () => ({
  listApplications: vi.fn(),
}))

import { listApplications } from '@/api/apps'
const mockListApps = vi.mocked(listApplications)

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading skeletons initially', () => {
    mockListApps.mockReturnValue(new Promise(() => {}))
    render(<DashboardPage />)
    expect(screen.getByText('Choose an app to get started')).toBeInTheDocument()
  })

  it('renders app cards when loaded', async () => {
    mockListApps.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 1,
          name: 'Writing Buddy',
          slug: 'writing-buddy',
          url: 'https://writing.labf.app',
          client_id: 'wb-client',
          redirect_uris: [],
          icon_url: null,
          stats_api_url: null,
          status: 'active',
          created_at: '2024-01-01',
        },
        {
          id: 2,
          name: 'Vocab Master',
          slug: 'vocab-master',
          url: 'https://vocab.labf.app',
          client_id: 'vm-client',
          redirect_uris: [],
          icon_url: null,
          stats_api_url: null,
          status: 'active',
          created_at: '2024-01-01',
        },
      ],
    })

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText('Writing Buddy')).toBeInTheDocument()
      expect(screen.getByText('Vocab Master')).toBeInTheDocument()
    })
  })

  it('shows empty state when no apps', async () => {
    mockListApps.mockResolvedValueOnce({
      success: true,
      data: [],
    })

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText('Welcome! Your apps are ready.')).toBeInTheDocument()
    })
  })

  it('shows error state with retry button', async () => {
    mockListApps.mockRejectedValueOnce(new Error('Network error'))

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    })
  })

  it('app cards link to app URLs', async () => {
    mockListApps.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 1,
          name: 'Writing Buddy',
          slug: 'writing-buddy',
          url: 'https://writing.labf.app',
          client_id: 'wb-client',
          redirect_uris: [],
          icon_url: null,
          stats_api_url: null,
          status: 'active',
          created_at: '2024-01-01',
        },
      ],
    })

    render(<DashboardPage />)

    await waitFor(() => {
      const link = screen.getByLabelText('Open Writing Buddy')
      expect(link).toHaveAttribute('href', 'https://writing.labf.app')
    })
  })
})
