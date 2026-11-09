import { Field, Input, Select } from "@/components/ui";

/** Timetable source fields, shared by the directory and institution setup pages. */
export function SourceFields({ type, url }: { type: string; url: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
      <Field label="Kind of source">
        <Select name="timetable_source_type" defaultValue={type}>
          <option value="none">None (upload PDFs by hand)</option>
          <option value="viewer_json">Timetable viewer with an API</option>
          <option value="pdf_links">Web page linking PDF timetables</option>
          <option value="pdf_url">A single PDF timetable</option>
        </Select>
      </Field>
      <Field label="Link" hint="https:// only. For a viewer, the site's address; for PDF pages, the index page that lists them.">
        <Input name="timetable_source_url" defaultValue={url} placeholder="https://" />
      </Field>
    </div>
  );
}
