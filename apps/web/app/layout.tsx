import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "서울온케어 그룹웨어",
  description: "병원 운영 관리 시스템",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="antialiased text-slate-900">{children}</body>
    </html>
  );
}
