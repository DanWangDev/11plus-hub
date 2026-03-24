import { useState, useCallback } from 'react'
import type { ZodSchema, ZodError } from 'zod'

interface UseFormOptions<T> {
  schema: ZodSchema<T>
  onSubmit: (data: T) => Promise<void>
}

interface UseFormReturn<T> {
  values: Partial<T>
  errors: Record<string, string>
  serverError: string
  isSubmitting: boolean
  setValue: (field: keyof T, value: string) => void
  handleSubmit: (e: React.FormEvent) => Promise<void>
  setServerError: (error: string) => void
}

export function useForm<T extends Record<string, unknown>>(
  options: UseFormOptions<T>,
): UseFormReturn<T> {
  const { schema, onSubmit } = options
  const [values, setValues] = useState<Partial<T>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const setValue = useCallback((field: keyof T, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      if (prev[field as string]) {
        const { [field as string]: _, ...rest } = prev
        return rest
      }
      return prev
    })
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setServerError('')
      setErrors({})

      const result = schema.safeParse(values)
      if (!result.success) {
        const zodError = result.error as ZodError
        const fieldErrors: Record<string, string> = {}
        for (const issue of zodError.issues) {
          const field = issue.path[0]
          if (field && !fieldErrors[String(field)]) {
            fieldErrors[String(field)] = issue.message
          }
        }
        setErrors(fieldErrors)
        return
      }

      setIsSubmitting(true)
      try {
        await onSubmit(result.data)
      } catch (error) {
        if (error instanceof Error) {
          setServerError(error.message)
        } else {
          setServerError('An unexpected error occurred')
        }
      } finally {
        setIsSubmitting(false)
      }
    },
    [values, schema, onSubmit],
  )

  return {
    values,
    errors,
    serverError,
    isSubmitting,
    setValue,
    handleSubmit,
    setServerError,
  }
}
