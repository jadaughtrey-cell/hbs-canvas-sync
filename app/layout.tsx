import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HBS Canvas Sync",
  description: "Sync your HBS Canvas assignments to Outlook — with cheat sheets",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
