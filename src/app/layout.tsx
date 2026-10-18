import type { Metadata } from "next";
import { Barlow_Condensed, Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const scoreboard = Barlow_Condensed({
  variable: "--font-scoreboard",
  subsets: ["latin"],
  weight: "600",
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
    <html
      lang="en"
      className={`${geistSans.variable} ${scoreboard.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
