import "./style.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Mimi · 私人特助",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Mimi" },
  icons: { apple: "/apple.png" },
};
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#eae6fb",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
