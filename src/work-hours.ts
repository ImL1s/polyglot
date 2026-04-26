import type { Profile } from "./profile.ts";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function isWithinWorkHours(p: Profile, now: Date = new Date()): boolean {
  if (!p.work_hours || !p.work_hours.includes("-")) return true;
  const day = WEEKDAY_SHORT[now.getDay()];
  if (!p.work_days.includes(day)) return false;
  const [start, end] = p.work_hours.split("-").map((s) => s.trim());
  const [sH, sM] = start.split(":").map(Number);
  const [eH, eM] = end.split(":").map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  const startMin = sH * 60 + sM;
  const endMin = eH * 60 + eM;
  return cur >= startMin && cur <= endMin;
}
