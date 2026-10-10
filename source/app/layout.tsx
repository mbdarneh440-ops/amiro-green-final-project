import type { Metadata } from "next";
import "./globals.css";
import "./wardiya.css";
import "./roster.css";

export const metadata: Metadata = {
  title: "אמירו גרין | ניהול צוותי אבטחה",
  description: "ניהול אתרים, זמינות מאבטחים, בדיקת בקשות וסידור עבודה במקום אחד.",
  icons: {
    icon: "/wardiya.svg",
    shortcut: "/wardiya.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
