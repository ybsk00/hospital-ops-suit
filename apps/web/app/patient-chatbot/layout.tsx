import { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: '서울온케어의원 AI 상담',
  description: '암 치료, 자율신경 치료 등 궁금한 점을 AI 상담 도우미에게 물어보세요.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function PatientChatbotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
