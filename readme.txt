Assembly date + calendar navigation patch

Replace:
- script.js
- style.css

What this adds:
- Quick assembly date buttons:
  Today
  -7 Days
  -30 Days
  Jump to… (manual date entry)
- Calendar days with assembly activity now include an Open Assembly button
- Clicking a calendar day with assembly work takes you straight to the Assembly page for that date
- Previous / Next Day buttons now keep the calendar month in sync with the assembly date


Attendance shared-sync patch
- Attendance now attempts to load and save through a Netlify Function at /.netlify/functions/attendance
- If that function is live and DATABASE_URL is set in Netlify, attendance becomes shared through Neon
- If the function is not available, attendance falls back to local browser storage and the banner says so
- The rest of the site is still browser-local for now

New files you must deploy too
- package.json
- netlify/functions/attendance.js

Netlify env var required
- DATABASE_URL = your Neon connection string
