BGauss BTL — 27.10.2026 part 8: Forward → state-wise summary mail IMMEDIATELY (midnight digest off)

BACKEND
  Services/ForwardSummaryMail.cs            NEW  (mail format + send as the Checker)
  Controllers/ProposalsController.cs        REPLACE (cumulative: includes all earlier changes)
      POST /api/proposals/forward-now                  forward selected + ONE summary mail now
      GET  /api/proposals/forward-summary/status       last mail sent / forwarded-not-mailed count
      POST /api/proposals/forward-summary/send-pending mail NOW whatever is still waiting (today's batch)
  Program.cs                                REPLACE (midnight digest hosted service commented out)
  appsettings.json → "Email" section:
      "SuppressIndividualForwardMails": true,
      "ForwardSummaryTo":  "durgesh.guptaa@bgauss.com",          <- confirm
      "ForwardSummaryCc":  "",                                    <- e.g. vijay.maurya@bgauss.com
      "ApproverPortalUrl": "https://btl.bgauss.com/approver"      <- confirm the Approver page route
  dotnet build → publish → restart

FRONTEND
  copy src/services/forwardSummaryService.ts, src/components/ForwardSummaryStatus.tsx
  node apply-changes-8.mjs frontend
  npm run build

TODAY'S BATCH (forwarded, waiting for midnight)
  After deploying: Approver page → amber banner "⚠ N forwarded proposals NOT yet mailed"
  → "📤 Send state-wise summary now". Do this BEFORE midnight is no longer relevant — the
  midnight job is switched off, so anything not mailed stays in that banner until sent.

SAMPLE_State-wise_Summary_Mail.html = the mail layout with dummy figures (for sharing / sign-off).
