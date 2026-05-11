# Smoke Test Checklist

Run through this after every deploy. Target time: ~5 minutes.

If any step fails, the deploy is broken. Either fix and redeploy, or `git revert <commit>` and push.

## Setup
- Open the deployed site in a fresh browser tab.
- Open DevTools (Cmd+Opt+I) → Console tab. Leave it open the whole time.
- Hard refresh: Cmd+Shift+R.

## 1. Load
- [ ] Page loads, no red errors in console
- [ ] Sidebar visible, can click between pages
- [ ] Home dashboard shows numbers (not stuck on "—" or blank)

## 2. Assembly Planner
- [ ] Navigate to Assembly Planner
- [ ] Date input shows today's date (not blank)
- [ ] Click the next/prev day arrows — date changes
- [ ] Type a different date directly — it sticks
- [ ] Live Output stats panel populates

## 3. Pack Builder Queue
- [ ] Navigate to Pack Builder Queue
- [ ] Ready / Incomplete / Scheduled tables all render (or show "Nothing scheduled" placeholders)
- [ ] Search box filters rows
- [ ] No console errors on this page

## 4. Schedule → Assembly round-trip (the high-risk flow)
- [ ] On Pack Builder Queue, click "Schedule" on any ready row
- [ ] Pick a date in the modal, confirm
- [ ] Row appears in Scheduled section
- [ ] Navigate to Assembly Planner with that date selected
- [ ] Scheduled row appears in the focus list

## 5. Unschedule (tonight's regression)
- [ ] From Assembly Planner, click Unschedule on a row
- [ ] Row disappears from focus list **immediately** (no refresh needed)
- [ ] Live Output stats decrease
- [ ] Row is back on the Pack Builder Queue (Ready section)
- [ ] **Edge case**: unschedule the LAST row on a day → focus list should clear, not stay stale

## 6. Issue hold
- [ ] On Scheduled queue row, click "Hold"
- [ ] Pick a reason in the modal, confirm
- [ ] Row leaves Scheduled, appears in issue-hold list
- [ ] Refresh — change persists

## 7. Import (skip if no test file handy)
- [ ] Import Hub → load a Salesforce queue XLSX → rows appear in Pack Builder Queue
- [ ] Import revenue reference XLSX → "Revenue reference imported: N rows" message

## 8. Attendance
- [ ] Navigate to Attendance
- [ ] Today's roster shows for "Receiving"
- [ ] Click an employee → toggle mark → demerit updates
- [ ] Refresh — change persists

## 9. After-test cleanup
- [ ] Reverse any test changes (re-schedule what you unscheduled, undo any hold)
- [ ] Console still has no red errors

---

## When something fails

1. Screenshot the console error.
2. Note which step failed.
3. `git log --oneline -5` — find the most recent commit.
4. If urgent: `git revert <hash>` and redeploy.
5. If not urgent: open the file mentioned in the error, fix, retest from step 1.
