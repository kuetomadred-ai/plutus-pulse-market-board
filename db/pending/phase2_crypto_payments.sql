-- PLOTOS: crypto payments table. Safe to run more than once. Adds a new table only.
CREATE TABLE IF NOT EXISTS public.pf_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  funding_request_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'nowpayments',
  provider_invoice_id text UNIQUE,
  provider_payment_id text,
  amount_usd numeric(12,2) NOT NULL CHECK (amount_usd > 0),
  pay_currency text,
  status text NOT NULL DEFAULT 'waiting',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pf_payments TO authenticated;
GRANT ALL ON public.pf_payments TO service_role;

ALTER TABLE public.pf_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pf_payments_read ON public.pf_payments;
CREATE POLICY pf_payments_read ON public.pf_payments
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('ADMIN', 'FINANCE')
  );

CREATE INDEX IF NOT EXISTS pf_payments_request_idx ON public.pf_payments (funding_request_id);
