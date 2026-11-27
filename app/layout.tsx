import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "intrisal.com",
  icons: {
    icon: [
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/brand/intrisal-icon-signal-256.png", sizes: "256x256", type: "image/png" },
    ],
    apple: [{ url: "/brand/intrisal-icon-signal-256.png", sizes: "256x256", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={outfit.variable} suppressHydrationWarning>
      <body>
        {/* beforeInteractive must live in the root layout; keeps Open-platform chrome hidden before hydrate. */}
        <Script
          id="intrisal-platform-enter"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(sessionStorage.getItem("intrisal-from-landing")==="1"){document.documentElement.dataset.platformEnter="1";}}catch(e){}})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
