import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bluebook Clone — SAT Practice",
  description:
    "A local, single-user clone of the College Board Bluebook digital SAT practice app.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
