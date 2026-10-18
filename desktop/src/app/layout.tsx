import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
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
  title: "Gantry",
  description: "Manage tickets, branch previews, and code reviews in one workspace",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* In the Mac app the window has no title bar: make room for the traffic lights. */}
        <script dangerouslySetInnerHTML={{ __html: 'if(/Electron/.test(navigator.userAgent)&&/Macintosh/.test(navigator.userAgent))document.documentElement.classList.add("electron")' }} />
      </head>
      <body className="h-full flex flex-col">
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
