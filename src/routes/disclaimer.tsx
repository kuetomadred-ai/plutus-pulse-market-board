import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/disclaimer")({
  component: () => (
    <main
      dir="rtl"
      className="mx-auto min-h-screen max-w-3xl space-y-5 bg-background p-6 text-foreground"
    >
      <a href="/">العودة</a>
      <h1 className="text-3xl font-bold">إخلاء المسؤولية</h1>
      <section className="space-y-4 leading-8">
        <p>
          PLUTUS منصة تعليمية وتقييمية للتداول المحاكى. الأسعار والنتائج الافتراضية قد تتأخر أو
          تختلف عن الأسواق الفعلية.
        </p>
        <p>
          لا تقدم المنصة نصيحة استثمارية أو ضريبة أو قانونية، ولا تضمن تحقيق أرباح أو اجتياز تقييم.
          اتخذ قراراتك المالية بعد الحصول على مشورة مهنية مستقلة.
        </p>
      </section>
    </main>
  ),
});
