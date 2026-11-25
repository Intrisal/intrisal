import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "intrisal.com",
  icons: { icon: "data:," },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
};

const themeBoot = `(function(){try{var c=localStorage.getItem("intrisal-theme-choice");var t="dark";if(c==="light"||c==="dark")t=c;else if(c==="auto"){var h=new Date().getHours();t=(h>=7&&h<19)?"light":"dark";}document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <Script id="intrisal-theme" strategy="beforeInteractive">
          {themeBoot}
        </Script>
        {children}
      </body>
    </html>
  );
}
