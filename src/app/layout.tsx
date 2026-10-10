import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { KeysBanner } from "./keys-banner";
import { Sidebar } from "./sidebar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hireloop · Recruiting agents",
  description: "AI recruiting agents with human approvals",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-page text-ink">
        {/* One look only (2026-10-09 mockup): dark left rail (logo, menu, Gmail, spend) + cream page. No top header, no dark mode. */}
        <div className="flex flex-1 flex-col md:flex-row">
          <Sidebar />
          <main className="min-w-0 flex-1 px-6 py-8">
            <div className="mx-auto max-w-6xl">
              <KeysBanner />
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
