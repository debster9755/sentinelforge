import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'SentinelForge · AI Security & FinOps Gateway',
  description: 'A zero-key policy gateway for safer, auditable, cost-aware AI traffic.',
  openGraph: {
    title: 'SentinelForge',
    description: 'AI security + FinOps gateway',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'SentinelForge — AI security + FinOps gateway' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SentinelForge',
    description: 'AI security + FinOps gateway',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
