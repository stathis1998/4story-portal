import type { LoginRequest, Me, RegisterRequest } from '@4story-portal/shared'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ApiError, apiFetch } from './api'

export const meQueryOptions = queryOptions({
  queryKey: ['me'],
  queryFn: async (): Promise<Me | null> => {
    try {
      return await apiFetch<Me>('/auth/me')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null
      throw error
    }
  },
  staleTime: Infinity,
  retry: false,
})

const post = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

function useSignedIn() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return async (user: Me) => {
    queryClient.setQueryData(meQueryOptions.queryKey, user)
    await navigate({ to: '/characters' })
  }
}

export function useLogin() {
  const onSuccess = useSignedIn()
  return useMutation({
    mutationKey: ['login'],
    mutationFn: (input: LoginRequest) => post<Me>('/auth/login', input),
    onSuccess,
  })
}

export function useRegister() {
  const onSuccess = useSignedIn()
  return useMutation({
    mutationKey: ['register'],
    // Only username and password go to the API; confirmPassword stays in the form.
    mutationFn: ({ username, password }: RegisterRequest) =>
      post<Me>('/auth/register', { username, password }),
    onSuccess,
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationKey: ['logout'],
    mutationFn: () => post<void>('/auth/logout'),
    onSettled: async () => {
      queryClient.clear()
      queryClient.setQueryData(meQueryOptions.queryKey, null)
      await navigate({ to: '/login' })
    },
  })
}
