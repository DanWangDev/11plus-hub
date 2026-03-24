import { Link } from 'react-router'
import { AuthLayout } from '@/components/AuthLayout'
import { Button } from '@/components/ui/Button'

export function NotFoundPage() {
  return (
    <AuthLayout title="Page Not Found" subtitle="We couldn't find what you were looking for">
      <div className="text-center">
        <p className="mb-6 text-sm text-slate-500">
          The page you are looking for might have been removed or is
          temporarily unavailable.
        </p>
        <Link to="/login">
          <Button variant="primary">Go to sign in</Button>
        </Link>
      </div>
    </AuthLayout>
  )
}
