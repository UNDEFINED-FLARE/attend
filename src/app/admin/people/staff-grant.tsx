"use client";
import { useState } from "react";
import { grantStaff } from "../actions";
import { ActionForm } from "@/components/form";
import { Field, Input, Select } from "@/components/ui";

type Opt = { id: string; name: string };

const ROLES: [string, string, string][] = [
  ["institution_admin", "Institution administrator", "Everything in this institution."],
  ["faculty_admin", "Faculty administrator", "One faculty's modules: attendance, reviews, reports."],
  ["department_admin", "Department administrator", "One department's modules: attendance, reviews, reports."],
  ["attendance_officer", "Attendance officer", "All attendance: reviews, disputes, corrections, exports."],
  ["integration_admin", "Integration administrator", "Connections, imports and sync runs. No attendance records."],
  ["auditor", "Auditor", "Reads attendance, decisions, the audit log and roles. Changes nothing."],
];

/** Give a colleague a role; faculty and department administrators also get their faculty or department. */
export function StaffGrant({ faculties, departments }: { faculties: Opt[]; departments: Opt[] }) {
  const [role, setRole] = useState("attendance_officer");
  const about = ROLES.find((r) => r[0] === role)?.[2];
  return (
    <ActionForm action={grantStaff} submit="Give role" className="grid gap-3 sm:grid-cols-2 [&>button]:sm:w-fit [&>[role]]:sm:col-span-2">
      <Field label="Their email" hint="They need a UniAttend account with a confirmed email."><Input name="email" type="email" placeholder="colleague@university.ac.za" required /></Field>
      <Field label="Role" hint={about}>
        <Select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      {role === "faculty_admin" && (
        <Field label="Faculty">
          <Select name="faculty_id" required defaultValue="">
            <option value="" disabled>{faculties.length ? "Choose a faculty" : "Add faculties first on Venues & map"}</option>
            {faculties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
      )}
      {role === "department_admin" && (
        <Field label="Department">
          <Select name="department_id" required defaultValue="">
            <option value="" disabled>{departments.length ? "Choose a department" : "Add departments first on Venues & map"}</option>
            {departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
      )}
    </ActionForm>
  );
}
