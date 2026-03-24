# STORAGE_KEYS.md

## Overview
This document lists all browser storage keys used in Warehouse Operations Hub.

All keys use `localStorage` unless otherwise noted.

These keys represent the **source of truth** for the app state. Most modules load from these keys on initialization and write back to them after updates.

---

## Core Storage Keys

### Attendance
- `ops_hub_attendance_records_v2`
  - Stores all attendance entries
  - Includes employee, department, date, and status
  - Used by Attendance + Home dashboard

- `ops_hub_attendance_backup_v2`
  - Backup snapshot used for undo/reset functionality

---

### Employees
- `ops_hub_employees_v1`
  - Master employee list
  - Shared across Attendance, Calendar, and Home

---

### Warehouse Errors
- `ops_hub_errors_records_v2`
  - Stores all error logs
  - Includes department, associate, PO/link, expected vs received values

---

### Assembly Board
- `ops_hub_assembly_board_v2`
  - Core Assembly workflow data
  - Includes pack builders, stages, units, and scheduling data
  - Synced to backend when available

---

### Queue System

#### Available Queue
- `ops_hub_available_queue_v1`
  - Pack builders ready to be scheduled
  - Source queue for Assembly planning

#### Scheduled Queue
- `ops_hub_scheduled_queue_v1`
  - Pack builders assigned to a specific date/time

#### Incomplete Queue
- `ops_hub_incomplete_queue_v1`
  - Pack builders that are blocked or missing items

---

### Revenue Reference
- `ops_hub_revenue_reference_v1`
  - Revenue lookup table for pack builders
  - Used by Assembly to calculate value impact

---

## Backend Sync (Netlify)

The following data is optionally synced via:

```
/.netlify/functions/assembly
```

Synced data includes:
- Assembly Board
- Available Queue
- Scheduled Queue
- Incomplete Queue
- Revenue Reference

If sync fails or is unavailable, the app continues using localStorage.

---

## Data Flow

### On Load
1. App loads from localStorage
2. Data is normalized into in-memory arrays
3. UI renders from in-memory state

### On Update
1. State is updated in memory
2. Saved to localStorage
3. (If applicable) synced to backend

---

## Important Notes

- Do NOT rename storage keys casually
  - This will break existing saved data

- Do NOT change data shape without normalization updates
  - Rendering depends on expected structure

- Always preserve backward compatibility when updating versions

---

## Versioning Strategy

Keys include version suffixes:
- `_v1`, `_v2`, etc.

When changing structure:
- create a new version key
- migrate old data if needed
- avoid destructive overwrites

---

## Summary

This storage system allows:
- full offline functionality
- persistence across sessions
- optional backend sync

It is a strong foundation but should be carefully managed during refactors.
