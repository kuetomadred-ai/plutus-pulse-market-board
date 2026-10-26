import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: () => (
    <main
      dir="rtl"
      className="mx-auto min-h-screen max-w-3xl space-y-5 bg-background p-6 text-foreground"
    >
      <a href="/">العودة</a>
      <h1 className="text-3xl font-bold">سياسة الخصوصية</h1>
      <section className="space-y-4 leading-8">
        <p>
          نجمع بيانات الحساب اللازمة لتسجيل الدخول وتشغيل التقييم المحاكى، ونسجل أوامر التداول
          وحالتها في جداول المحرك الخادمي.
        </p>
        <p>
          لا تُحفظ مفاتيح الخدمة أو أسرار الدفع في المتصفح. لا نبيع بيانات المستخدمين. تُستخدم
          بيانات الدفع عبر مزود الدفع لمعالجة الفاتورة وفق شروطه.
        </p>
        <p>لطلب تصحيح أو حذف البيانات، تواصل مع مالك الخدمة من خلال قناة الدعم المعتمدة.</p>
      </section>
    </main>
  ),
});
