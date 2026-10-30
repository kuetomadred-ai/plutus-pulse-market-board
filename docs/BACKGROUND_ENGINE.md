# العامل الخلفي لمحرك PLUTUS

محرك PLUTUS محاكاة فقط. بعد تطبيق migration المحرك، تحفظ الحسابات والأوامر والصفقات في `pf_engine_*` داخل Supabase، لذلك لا تعتمد حالة التداول على `localStorage` أو بقاء التطبيق مفتوحًا.

## المسار المجاني الموصى به

يحتوي المستودع على Edge Function باسم `engine-worker`. كل تشغيل يجلب آخر الأسعار من Biquote، ثم يستدعي `pf_engine_process_tick` لكل أداة مفعلة. هذا يغلق SL/TP ويفعّل الأوامر المعلقة ويشغل تقييم المخاطر حتى لو كان الهاتف أو المتصفح مغلقًا. يوجد قفل وقائي fenced lease في `pf_engine_worker_runs` يمنع تشغيل نسختين في الوقت نفسه، ويمنع العامل القديم من تحرير قفل عامل أحدث بعد انتهاء مهلة الأول، وتظل حالة آخر تشغيل قابلة للفحص.

هذا المسار يعمل بدقة دورة الجدولة، وليس كتدفق tick لحظي. للمراقبة اللحظية أثناء تشغيل خادم مستمر يمكن تشغيل `backend/src/worker.ts`، لكن Edge Function هو مسار الاستمرارية الأساسي.

## التفعيل مرة واحدة

1. طبّق migrations بالترتيب، خصوصًا:
   - `20261016090000_server_side_paper_engine.sql`
   - `20261026190000_background_engine_worker.sql`
   - `20261030130000_fenced_background_worker_lease.sql`
2. فعّل امتدادي `pg_cron` و`pg_net` من Supabase Dashboard > Database > Extensions. إذا كنت تستخدم SQL Editor بدل لوحة التحكم، نفّذ:

```sql
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
```

لا تغيّر المنطقة الزمنية إلى توقيت الهاتف؛ Supabase يضبط قاعدة البيانات على UTC افتراضيًا، وهذا هو الإعداد الموصى به. لذلك تعني جدولة `* * * * *` بداية كل دقيقة UTC.

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

5. أنشئ جدولة دقيقة واحدة. الكتلة التالية قابلة لإعادة التنفيذ؛ فهي تلغي أي جدولة قديمة بالاسم نفسه قبل إنشاء الجديدة:

```sql
do $$
begin
  if exists (select 1 from cron.job where jobname = 'plutus-engine-every-minute') then
    perform cron.unschedule('plutus-engine-every-minute');
  end if;
end
$$;

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
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
```

يستخدم العامل سرًا مخصصًا في ترويسة `Authorization`. لا تستخدم `SUPABASE_PUBLISHABLE_KEY` لهذا الاستدعاء. يظل `verify_jwt = false` في `supabase/config.toml` لأن العامل يتحقق من `ENGINE_WORKER_SECRET` داخل الكود. لا تضع السر في SQL محفوظ داخل Git؛ قيمة Vault تُقرأ وقت التشغيل.

تحقق أولًا من وجود جدولة واحدة فقط ومن توقيت الخادم:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'plutus-engine-every-minute';

select now() as database_now, current_setting('TIMEZONE') as database_timezone;
```

يمكن التحقق من الطلبات من `net._http_response` ومن حالة العامل. لأن `pg_net` غير متزامن، فإن نجاح `cron.schedule` يعني وضع طلب HTTP في الطابور، وليس اكتمال معالجة الأسعار. استخدم `status_code`, `timed_out`, و`error_msg` للتحقق من النتيجة:

```sql
select worker_name, last_status, last_processed, last_started_at, last_finished_at, last_error
from public.pf_engine_worker_runs
where worker_name = 'engine-tick';

select id, status_code, timed_out, error_msg, created
from net._http_response
where created > now() - interval '30 minutes'
order by created desc
limit 30;
```

## ملاحظات التشغيل المجاني

الجدولة الدقيقة تعتمد على حدود وحصة خطة Supabase الحالية. إذا توقفت الوظائف بسبب حدود الخطة، لا يوجد حل مجاني يضمن 24/7 خارج خدمة تعمل باستمرار؛ يمكن عندها تشغيل `bun run worker` على جهاز شخصي يبقى متصلًا بالإنترنت، أو استخدام استضافة دائمة مدفوعة. لا تستخدم ping للتحايل على نوم خدمة مجانية.

الأسعار لا تُخزّن كحقيقة من العميل. كل تنفيذ يمر عبر RPC محمي بصلاحية `service_role`، والأسعار القديمة أو غير الصالحة تُرفض. يعيد جلب الأسعار المحمي في مسار الخادم المحاولة حتى ثلاث مرات بمهلة قصيرة عند أخطاء الشبكة العابرة، ويمكن ضبط مصدر الأسعار عبر `BIQUOTE_URL`. هذه المنظومة لا ترسل أوامر إلى وسيط حقيقي.

## جدولة GitHub Actions والمحرك السحابي

أضيف workflow اختياري في `.github/workflows/trade-monitor.yml` يعمل كل خمس دقائق ويستدعي مسار `monitor-trades`. لتفعيله، أضف Secrets إلى مستودع GitHub:

- `APP_URL`: عنوان التطبيق المنشور، مثل `https://example.com`.
- `LOVABLE_CRON_SECRET`: نفس السر الموجود في بيئة التطبيق باسم `LOVABLE_CRON_SECRET`.

يمكن تشغيله يدويًا من تبويب Actions. هذا المسار يراقب الصفقات السحابية في PostgreSQL، لذلك يستمر تنفيذ SL/TP عند إغلاق التطبيق.

لم يعد مسار التداول الإنتاجي يستخدم `localStorage` أو Paper محليًا كبديل صامت. إذا لم تكن جلسة الخادم جاهزة، يوقف فتح/تعديل/إغلاق الصفقة برسالة واضحة بدل إنشاء صفقة لا يستطيع العامل الخلفي مراقبتها. التخزين المحلي قد يبقى لتفضيلات الواجهة فقط، وليس مصدر حقيقة للصفقات.

حساب Demo يستخدم `plutus_demo_*` موقّعًا بـ HMAC-SHA256 بواسطة سر خادمي (`SUPABASE_SERVICE_ROLE_KEY` أو `LOVABLE_CRON_SECRET`). يتحقق `terminal-engine.server.ts` من التوقيع والانتهاء قبل ربط الطلب بـ `user_id` وتنفيذ RPC على PostgreSQL. لا تستخدم هذه الآلية Magic Links أو Supabase Password Auth، ولا تُرسل أسرار الخادم إلى العميل.

## مصادر Supabase الرسمية

- [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [pg_net: Async Networking](https://supabase.com/docs/guides/database/extensions/pg_net)
- [Database configuration and UTC timezone](https://supabase.com/docs/guides/database/postgres/configuration)
