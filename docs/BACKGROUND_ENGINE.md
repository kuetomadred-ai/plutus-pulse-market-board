# العامل الخلفي لمحرك PLUTUS

محرك PLUTUS محاكاة فقط. بعد تطبيق migration المحرك، تحفظ الحسابات والأوامر والصفقات في `pf_engine_*` داخل Supabase، لذلك لا تعتمد حالة التداول على `localStorage` أو بقاء التطبيق مفتوحًا.

## المسار المجاني الموصى به

يحتوي المستودع على Edge Function باسم `engine-worker`. كل تشغيل يجلب آخر الأسعار من Biquote، ثم يستدعي `pf_engine_process_tick` لكل أداة مفعلة. هذا يغلق SL/TP ويفعّل الأوامر المعلقة ويشغل تقييم المخاطر حتى لو كان الهاتف أو المتصفح مغلقًا. يوجد قفل وقائي في `pf_engine_worker_runs` يمنع تشغيل نسختين في الوقت نفسه، وتظل حالة آخر تشغيل قابلة للفحص.

هذا المسار يعمل بدقة دورة الجدولة، وليس كتدفق tick لحظي. للمراقبة اللحظية أثناء تشغيل خادم مستمر يمكن تشغيل `backend/src/worker.ts`، لكن Edge Function هو مسار الاستمرارية الأساسي.

## التفعيل مرة واحدة

1. طبّق migrations بالترتيب، خصوصًا:
   - `20261016090000_server_side_paper_engine.sql`
   - `20261026190000_background_engine_worker.sql`
2. فعّل امتدادي `pg_cron` و`pg_net` من Supabase Dashboard > Database > Extensions.
3. انشر الدالة:

```sh
supabase functions deploy engine-worker --no-verify-jwt
supabase secrets set ENGINE_WORKER_SECRET="ضع-سرًا-عشوائيًا-طويلًا" BIQUOTE_URL="https://biquote.io"
```

يجب أن تكون `SUPABASE_SERVICE_ROLE_KEY` ضمن أسرار بيئة Edge Function. لا تضعها في التطبيق أو Git.

4. خزّن عنوان الدالة والسر في Vault، وليس في نص SQL أو Git. نفّذ SQL التالي بعد استبدال القيم محليًا فقط:

```sql
select vault.create_secret(
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/engine-worker',
  'engine_worker_url',
  'PLUTUS background engine worker URL'
);
select vault.create_secret(
  'YOUR_ENGINE_WORKER_SECRET',
  'engine_worker_secret',
  'PLUTUS background engine worker bearer secret'
);
```

5. أنشئ جدولة دقيقة واحدة. يمكن تنفيذها من SQL Editor بعد تفعيل `pg_cron` و`pg_net`:

```sql
select cron.schedule(
  'plutus-engine-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'engine_worker_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'engine_worker_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

يمكن التحقق من الطلبات من `net._http_response` ومن حالة العامل عبر:

```sql
select worker_name, last_status, last_processed, last_started_at, last_finished_at, last_error
from public.pf_engine_worker_runs
where worker_name = 'engine-tick';
```

## ملاحظات التشغيل المجاني

الجدولة الدقيقة تعتمد على حدود وحصة خطة Supabase الحالية. إذا توقفت الوظائف بسبب حدود الخطة، لا يوجد حل مجاني يضمن 24/7 خارج خدمة تعمل باستمرار؛ يمكن عندها تشغيل `bun run worker` على جهاز شخصي يبقى متصلًا بالإنترنت، أو استخدام استضافة دائمة مدفوعة. لا تستخدم ping للتحايل على نوم خدمة مجانية.

الأسعار لا تُخزّن كحقيقة من العميل. كل تنفيذ يمر عبر RPC محمي بصلاحية `service_role`، والأسعار القديمة أو غير الصالحة تُرفض. هذه المنظومة لا ترسل أوامر إلى وسيط حقيقي.

## جدولة GitHub Actions والمحرك السحابي

أضيف workflow اختياري في `.github/workflows/trade-monitor.yml` يعمل كل خمس دقائق ويستدعي مسار `monitor-trades`. لتفعيله، أضف Secrets إلى مستودع GitHub:

- `APP_URL`: عنوان التطبيق المنشور، مثل `https://example.com`.
- `LOVABLE_CRON_SECRET`: نفس السر الموجود في بيئة التطبيق باسم `LOVABLE_CRON_SECRET`.

يمكن تشغيله يدويًا من تبويب Actions. هذا المسار يراقب الصفقات السحابية في PostgreSQL، لذلك يستمر تنفيذ SL/TP عند إغلاق التطبيق.

لم يعد مسار التداول الإنتاجي يستخدم `localStorage` أو Paper محليًا كبديل صامت. إذا لم تكن جلسة الخادم جاهزة، يوقف فتح/تعديل/إغلاق الصفقة برسالة واضحة بدل إنشاء صفقة لا يستطيع العامل الخلفي مراقبتها. التخزين المحلي قد يبقى لتفضيلات الواجهة فقط، وليس مصدر حقيقة للصفقات.
