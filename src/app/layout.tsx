import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "700", "800", "900"],
  display: "block",
});

export const metadata: Metadata = {
  title: {
    default: "Slophoot",
    template: "%s · Slophoot",
  },
  description: "Self-hosted quiz lobby. Join with a PIN or host a room.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${montserrat.variable} ${montserrat.className} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
