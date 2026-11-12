"use client";
import { useState } from "react";
import { announceToInstitution } from "@/app/push-actions";
import { ActionForm } from "@/components/form";
import { Field, Input, Select, Textarea } from "@/components/ui";

type Opt = { id: string; label: string };
const TARGETS = [
  ["all", "Everyone"], ["faculty", "A faculty"], ["department", "A department"], ["module", "A module's class"],
  ["student", "One student"], ["lecturer", "One lecturer"],
] as const;
export const CATEGORIES = [
  ["announcement", "General"], ["academic", "Academic update"], ["system", "System notice"], ["class_cancelled", "Class cancelled"],
  ["venue_change", "Venue change"], ["timetable_change", "Timetable change"], ["class_reminder", "Reminder"],
] as const;

/** Send an announcement to everyone, a faculty, a department, a module, one student or one lecturer. */
export function AnnounceForm({ faculties, departments, modules, lecturers }: { faculties: Opt[]; departments: Opt[]; modules: Opt[]; lecturers: Opt[] }) {
  const [target, setTarget] = useState<(typeof TARGETS)[number][0]>("all");
  const options = target === "faculty" ? faculties : target === "department" ? departments : target === "module" ? modules : target === "lecturer" ? lecturers : [];
  return (
    <ActionForm action={announceToInstitution} submit="Send" pending="Sending…" className="grid gap-3 md:grid-cols-3 [&>[role]]:md:col-span-3 [&>button]:md:w-fit">
      <Field label="Send to">
        <Select name="target_kind" value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
          {TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      {target === "student" ? (
        <Field label="Student number"><Input name="student_number" placeholder="22012345" required /></Field>
      ) : target !== "all" ? (
        <Field label="Which">
          <Select name="target_id" required defaultValue="">
            <option value="" disabled>Choose…</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
        </Field>
      ) : (
        <Field label="Who">
          <Select name="audience" defaultValue="students">
            <option value="students">Students</option><option value="lecturers">Lecturers</option>
            <option value="admins">Administrators</option><option value="all">Everyone</option>
          </Select>
        </Field>
      )}
      {target !== "all" && target !== "student" && target !== "lecturer" && (
        <input type="hidden" name="audience" value={target === "module" ? "students" : "all"} />
      )}
      {(target === "student" || target === "lecturer") && <input type="hidden" name="audience" value="all" />}
      <Field label="Type">
        <Select name="category" defaultValue="announcement">{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      </Field>
      <div className="md:col-span-3"><Field label="Title"><Input name="title" placeholder="Lectures cancelled on Friday" required maxLength={120} /></Field></div>
      <div className="md:col-span-3"><Field label="Message"><Textarea name="body" placeholder="Graduation takes place in the main hall. All lectures move online." required maxLength={2000} /></Field></div>
    </ActionForm>
  );
}
