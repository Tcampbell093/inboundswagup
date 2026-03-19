Assembly sync patch

What this patch does
- Converts Assembly operations into a shared backend-backed module
- Syncs these sections across devices through Netlify + Neon:
  - Assembly board
  - Available queue
  - Scheduled queue
  - Incomplete queue
  - Revenue reference library
- Keeps local browser storage as a fallback if the backend is unavailable

Files that must be present in the deployed repo root
- index.html
- script.js
- style.css
- workflow.html
- package.json
- netlify/functions/assembly.js

Environment
- DATABASE_URL must be set in Netlify

How to test
1. Open https://lustrous-crepe-d6380e.netlify.app/.netlify/functions/assembly
2. You should get JSON back
3. Make an Assembly or Queue change on the computer
4. Refresh the same page on the phone
5. The same assembly data should appear there too
