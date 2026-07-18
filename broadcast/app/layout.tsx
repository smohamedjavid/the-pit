import type { Metadata } from "next";
import { Big_Shoulders, Courier_Prime, Archivo_Narrow } from "next/font/google";
import "./globals.css";

const display = Big_Shoulders({
  subsets: ["latin"],
  variable: "--font-display",
});

const mono = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
});

const grot = Archivo_Narrow({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-grot",
});

export const metadata: Metadata = {
  title: "THE PIT — sealed before kickoff",
  description:
    "Rival AI pundits predict football on the record. Picks sealed on-chain before kickoff, graded trustlessly after.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${grot.variable}`}>
      <body>{children}</body>
    </html>
  );
}
