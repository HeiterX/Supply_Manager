import type { Metadata } from 'next';
import localFont from 'next/font/local';

import './globals.css';
import OfflineNotice from './components/OfflineNotice';

const geistSans = localFont({
  src: './fonts/Geist-Variable.ttf',
  variable: '--font-geist-sans',
  weight: '100 900',
  display: 'swap',
});

const geistMono = localFont({
  src: './fonts/GeistMono-Variable.ttf',
  variable: '--font-geist-mono',
  weight: '100 900',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Supply Manager',
  description: 'Система управления задачами по снабжению',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <OfflineNotice />
        {children}
      </body>
    </html>
  );
}
