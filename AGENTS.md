<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep `/` as the canonical trading screen and redirect the legacy `/index` preview URL to it so imported preview links remain valid.
- Preserve the imported static terminal in its same-origin iframe; the explicit demo query opens its existing paper account without waiting for external authentication, while native and staff entry retain authentication.
- The current Cloud Drizzle migration set is authoritative for the engine; historical Supabase SQL is reference-only, preventing duplicate schema paths.
- Route terminal engine calls through authenticated same-origin TanStack server handlers; derive identity from verified tokens and keep privileged RPC execution server-only.
- The terminal uses `/api/public/engine/*` with caller verification in each handler; ordinary reads use the caller's RLS client and RPC writes derive user identity server-side, so imported static clients never require a separate privileged server.
- Run quote monitoring through the managed cron-authenticated callback, never through browser timers as the independent source of risk enforcement.
