"use client";
import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";

type Saved = Record<string, unknown> & { map?: Record<string, unknown> };
const s = (v: unknown, d = "") => (typeof v === "string" || typeof v === "number" ? String(v) : d);

/** Settings for "UniAttend reads your system's API": address, sign-in, paging and which field holds what. */
export function RestFields({ saved, baseUrl, editing }: { saved?: Saved; baseUrl?: string | null; editing: boolean }) {
  const r = saved ?? {};
  const m = (r.map ?? {}) as Record<string, unknown>;
  const [auth, setAuth] = useState(s(r.auth, "bearer"));
  const [paging, setPaging] = useState(s(r.paging, "none"));
  const secretHint = editing ? "Leave empty to keep the one saved." : undefined;

  return (
    <div className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">Address and sign-in</legend>
        <Field label="Address of the first page" hint="The https address that lists students and lecturers with their modules, e.g. https://sis.example.ac.za/api/v1/enrolments">
          <Input name="base_url" type="url" required defaultValue={baseUrl ?? ""} placeholder="https://sis.example.ac.za/api/v1/enrolments" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How UniAttend signs in">
            <Select name="rest_auth" value={auth} onChange={(e) => setAuth(e.target.value)}>
              <option value="bearer">Bearer token</option>
              <option value="header">API key in a header</option>
              <option value="oauth2">OAuth client credentials</option>
              <option value="none">No sign-in</option>
            </Select>
          </Field>
          {auth === "header" && <Field label="Header name"><Input name="rest_header_name" defaultValue={s(r.header_name, "X-API-Key")} /></Field>}
          {(auth === "bearer" || auth === "header") && (
            <Field label={auth === "bearer" ? "Token" : "API key"} hint={secretHint}>
              <Input name="token" type="password" autoComplete="off" required={!editing} placeholder={editing ? "••••••••" : ""} />
            </Field>
          )}
        </div>
        {auth === "oauth2" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Token address" hint="Where UniAttend asks for an access token."><Input name="rest_token_url" type="url" required defaultValue={s(r.token_url)} placeholder="https://login.example.ac.za/oauth2/token" /></Field>
            <Field label="Client ID"><Input name="rest_client_id" required defaultValue={s(r.client_id)} /></Field>
            <Field label="Client secret" hint={secretHint}><Input name="token" type="password" autoComplete="off" required={!editing} placeholder={editing ? "••••••••" : ""} /></Field>
            <Field label="Scope (optional)"><Input name="rest_scope" defaultValue={s(r.scope)} /></Field>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">Records and pages</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Where the records are" hint="The field that holds the list, e.g. data or results.items. Empty if the answer is the list itself.">
            <Input name="rest_records" defaultValue={s(r.records)} placeholder="data" />
          </Field>
          <Field label="Pages">
            <Select name="rest_paging" value={paging} onChange={(e) => setPaging(e.target.value)}>
              <option value="none">Everything in one answer</option>
              <option value="page">Page numbers (?page=1&per_page=200)</option>
              <option value="offset">Offset and limit (?offset=0&limit=200)</option>
              <option value="next">A link to the next page</option>
            </Select>
          </Field>
        </div>
        {paging === "page" && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Page parameter"><Input name="rest_page_param" defaultValue={s(r.page_param, "page")} /></Field>
            <Field label="Size parameter"><Input name="rest_size_param" defaultValue={s(r.size_param, "per_page")} /></Field>
            <Field label="Page size"><Input name="rest_page_size" type="number" min={1} max={5000} defaultValue={s(r.page_size, "200")} /></Field>
            <Field label="First page is"><Select name="rest_first_page" defaultValue={s(r.first_page, "1")}><option value="1">1</option><option value="0">0</option></Select></Field>
          </div>
        )}
        {paging === "offset" && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Offset parameter"><Input name="rest_offset_param" defaultValue={s(r.offset_param, "offset")} /></Field>
            <Field label="Limit parameter"><Input name="rest_limit_param" defaultValue={s(r.limit_param, "limit")} /></Field>
            <Field label="Page size"><Input name="rest_page_size" type="number" min={1} max={5000} defaultValue={s(r.page_size, "200")} /></Field>
          </div>
        )}
        {paging === "next" && (
          <Field label="Where the next page's address is" hint="e.g. links.next or next. Leave empty if your API sends a Link header.">
            <Input name="rest_next_path" defaultValue={s(r.next_path)} placeholder="links.next" />
          </Field>
        )}
        {paging !== "none" && (
          <Field label="Most pages in one sync"><Input name="rest_max_pages" type="number" min={1} max={1000} defaultValue={s(r.max_pages, "200")} className="sm:w-40" /></Field>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">Which field holds what</legend>
        <p className="text-xs text-muted">Each record is one person with their modules. Use the field names from your API; dots go deeper, e.g. student.number.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Student or staff number *"><Input name="rest_map_number" required defaultValue={s(m.number)} placeholder="student_number" /></Field>
          <Field label="Module code(s) *" hint="A list, or text like CSC1541; MAT1541."><Input name="rest_map_module_codes" required defaultValue={s(m.module_codes)} placeholder="modules" /></Field>
          <Field label="Full name"><Input name="rest_map_full_name" defaultValue={s(m.full_name)} placeholder="name" /></Field>
          <Field label="Email"><Input name="rest_map_email" defaultValue={s(m.email)} placeholder="email" /></Field>
          <Field label="First name" hint="If there is no full name."><Input name="rest_map_first_name" defaultValue={s(m.first_name)} /></Field>
          <Field label="Last name"><Input name="rest_map_last_name" defaultValue={s(m.last_name)} /></Field>
          <Field label="Role" hint="A field saying student or lecturer. Empty: everyone gets the default below."><Input name="rest_map_role" defaultValue={s(m.role)} placeholder="type" /></Field>
          <Field label="Default role">
            <Select name="rest_map_role_default" defaultValue={s(m.role_default, "student")}><option value="student">Student</option><option value="lecturer">Lecturer</option></Select>
          </Field>
          <Field label="Module title" hint="Used when each record names one module."><Input name="rest_map_module_title" defaultValue={s(m.module_title)} /></Field>
        </div>
      </fieldset>
    </div>
  );
}
