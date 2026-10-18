import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Host",
};

export default function HostLayout({ children }: { children: ReactNode }) {
  return children;
}
