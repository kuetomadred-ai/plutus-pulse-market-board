import { createFileRoute } from "@tanstack/react-router";
import type React from "react";

export const Route = createFileRoute("/terms")({
  component: () => (
    <LegalPage title="شروط الاستخدام">
      <p>
        تستخدم PLUTUS للتداول المحاكى والتقييم فقط. لا تمثل الأرصدة أو النتائج أموالًا حقيقية ولا
        تنشئ علاقة وساطة أو استشارة مالية.
      </p>
      <p>
        يجب على المستخدم حماية بيانات الدخول وعدم محاولة تجاوز ضوابط الخادم أو التلاعب بالطلبات.
        يجوز إيقاف الحسابات التي تخالف هذه الشروط.
      </p>
    </LegalPage>
  ),
});

function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main
      dir="rtl"
      className="mx-auto min-h-screen max-w-3xl space-y-5 bg-background p-6 text-foreground"
    >
      <a href="/">العودة</a>
      <h1 className="text-3xl font-bold">{title}</h1>
      <section className="space-y-4 leading-8">{children}</section>
    </main>
  );
}
