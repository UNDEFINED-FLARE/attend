"use client";
import { useState } from "react";
import { ActionForm } from "@/components/form";
import { Icon, type IconName } from "@/components/icons";
import { Field, Input, Select, Textarea } from "@/components/ui";

type State = { error?: string; ok?: string } | undefined;
type Action = (s: State, f: FormData) => Promise<State>;
type Tab = "one" | "paste" | "csv";

const TABS: [Tab, string, IconName][] = [
  ["one", "One student", "user"],
  ["paste", "Paste a list", "file"],
  ["csv", "Upload a file", "download"],
];

export function StudentAdder({ modules, addOne, paste, upload }: {
  modules: { code: string; title: string }[];
  addOne: Action; paste: Action; upload: Action;
}) {
  const [tab, setTab] = useState<Tab>("one");
  return (
    <div>
      <div role="tablist" aria-label="How to add students" className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-bg p-1">
        {TABS.map(([t, label, icon]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium sm:text-sm ${tab === t ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
            <Icon name={icon} size={16} />{label}
          </button>
        ))}
      </div>

      {tab === "one" && (
        <ActionForm action={addOne} submit="Add student" pending="Adding…">
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <Field label="Student number"><Input name="student_number" required autoComplete="off" placeholder="22012345" /></Field>
            <Field label="Full name"><Input name="full_name" required autoComplete="off" placeholder="Thabo Mulaudzi" /></Field>
          </div>
          <Field label="Email (optional)" hint="Their university email. They get access when they sign up with it.">
            <Input name="email" type="email" autoComplete="off" placeholder="22012345@students.example.ac.za" />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Enrol in modules (optional)</legend>
            {modules.length === 0 ? <p className="text-xs text-muted">Create modules first to enrol students here.</p> : (
              <div className="grid max-h-44 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
                {modules.map((m) => (
                  <label key={m.code} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-bg">
                    <input type="checkbox" name="module_code" value={m.code} className="size-4 accent-[var(--accent)]" />
                    <span className="truncate"><b>{m.code}</b> <span className="text-muted">{m.title}</span></span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <p className="text-xs text-muted">An existing student number is updated and enrolled, never duplicated.</p>
        </ActionForm>
      )}

      {tab === "paste" && (
        <ActionForm action={paste} submit="Add students" pending="Adding…">
          <Field label="One student per line" hint="Student number, full name, email (optional), module code (optional). You can paste straight from Excel; include the heading row and the columns can be in any order.">
            <Textarea name="list" required rows={8} className="font-mono text-xs"
              placeholder={"22012345, Thabo Mulaudzi, 22012345@students.example.ac.za, CSC1541\n22012346, Lufuno Netshiongolwe\n22012347, Ntsako Baloyi, , CSC1541"} />
          </Field>
          {modules.length > 0 && (
            <Field label="Enrol everyone in (optional)" hint="Used for lines without their own module code.">
              <Select name="module_code" defaultValue=""><option value="">No module</option>
                {modules.map((m) => <option key={m.code} value={m.code}>{m.code} · {m.title}</option>)}</Select>
            </Field>
          )}
        </ActionForm>
      )}

      {tab === "csv" && (
        <ActionForm action={upload} submit="Import students" pending="Importing…">
          <p className="text-sm text-muted">
            Excel, CSV, Word or PDF, up to 5 MB and 10,000 students. The list needs a heading row with
            {" "}<b>Student number</b> and <b>Name</b> (or <b>First name</b> and <b>Surname</b>);
            {" "}<b>Email</b> and <b>Module</b> are optional. Columns can be in any order, and titles above the list are ignored.
          </p>
          <Input type="file" name="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt,.docx,.pdf,text/csv,application/pdf" required className="py-1.5" />
          <p className="text-xs text-muted">An existing student number is updated, never duplicated, so it is safe to import the same list again.</p>
        </ActionForm>
      )}
    </div>
  );
}
