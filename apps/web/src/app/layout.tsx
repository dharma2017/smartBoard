import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Smartboard · A little context, a lot of understanding",
  description:
    "An interactive learning board with smart selection and contextual AI assistance.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
