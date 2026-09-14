import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-6 text-2xl font-bold text-brand-700">
        PharmaIQ
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
