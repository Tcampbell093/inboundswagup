Live Production Board (separate read-only frontend)

Files:
- live-production-board.html
- live-production-board.css
- live-production-board.js

How to use:
1. Put these files in a separate lightweight Netlify site or separate repo.
2. Copy your existing netlify/functions/assembly.js into that site too.
3. Set the same DATABASE_URL in Netlify for that site.
4. Open live-production-board.html as the main page (rename to index.html if needed).

What it does:
- Pulls scheduled assembly data from /.netlify/functions/assembly
- Groups rows by scheduled day
- Shows only read-only schedule visibility
- Includes Account Owner, Revenue, and Reschedule Notes
- Auto-refreshes every 60 seconds

Why separate:
- Shared viewers cannot navigate into your internal operations UI because this frontend contains only the board.
