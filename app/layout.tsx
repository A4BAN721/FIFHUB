import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { LanguageProvider } from '@/components/language-provider'

export const metadata: Metadata = {
  title: 'FIFHUB | FIFA World Cup 2026',
  description:
    'Follow the FIFA World Cup 2026 with FIFHUB: squads, fixtures, live scores, standings, player details, groups, knockout brackets, and English or Bangla support.',
  keywords: [
    'FIFHUB',
    'FIFA World Cup 2026',
    'World Cup 2026',
    'Football',
    'Soccer',
    'Fixtures',
    'Live Scores',
    'Standings',
    'Players',
    'Squads',
    'Bangla football',
  ],
  openGraph: {
    title: 'FIFHUB | FIFA World Cup 2026',
    description:
      'The must-have FIFA World Cup 2026 companion for squads, fixtures, live scores, standings, player details, groups, knockout brackets, and bilingual coverage.',
    siteName: 'FIFHUB',
    type: 'website',
    images: [
      {
        url: '/fithub-social-preview.png',
        width: 204,
        height: 84,
        alt: 'FIFHUB World Cup 2026',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FIFHUB | FIFA World Cup 2026',
    description:
      'Track FIFA World Cup 2026 squads, fixtures, live scores, standings, player details, groups, and knockout brackets in one place.',
    images: ['/fithub-social-preview.png'],
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f5' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1a1f' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark bg-background" style={{ colorScheme: 'dark' }} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableColorScheme enableSystem={false} disableTransitionOnChange>
          <LanguageProvider>
            {children}
          </LanguageProvider>
        </ThemeProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
