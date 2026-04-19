import { ReactNode } from "react";
import { Footer } from "@/components/Footer";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 flex flex-col min-h-0">
        {children}
      </main>
      <Footer />
    </div>
  );
}
