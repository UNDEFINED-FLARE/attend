import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, LinkButton, Notice, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Institution directory" };

type Entry = { id: string; name: string; short_name: string | null; kind: string; province: string | null; timetable_source_type: string;
  timetable_source_url: string | null; timetable_note: string | null; campuses: { name: string; located?: boolean; lat: number | null }[] };

const KIND: Record<string, string> = { university: "University", university_of_technology: "University of technology", tvet_college: "TVET college", college: "College" };
const SOURCE: Record<string, string> = { none: "No timetable source", viewer_json: "Timetable viewer (API)", pdf_links: "PDF timetable pages", pdf_url: "Single PDF" };

export default async function Directory() {
  const { supabase } = await requireRole("super_admin");
  const { data, error } = await supabase.from("institution_directory").select("*").order("province").order("name");
  const entries = (data ?? []) as Entry[];
  return (
    <>
      <PageHeader title="Institution directory"
        subtitle="Known institutions with their campus maps and timetable links. Apply one to a registered institution from its Set up page."
        action={<LinkButton href="/super/directory/new"><Icon name="plus" size={16} />Add institution</LinkButton>} />
      {error && <Notice tone="bad">The directory isn&apos;t available yet. Run supabase/migrations/20261109000009_institution_setup.sql in the Supabase SQL Editor.</Notice>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {entries.map((e) => {
          const located = e.campuses.filter((c) => c.lat != null).length;
          return (
            <Link key={e.id} href={`/super/directory/${e.id}`} className="rounded-2xl bg-surface p-5 shadow-card transition hover:-translate-y-0.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{e.name}</p>
                  <p className="text-xs text-muted">{e.short_name ? `${e.short_name} · ` : ""}{KIND[e.kind] ?? e.kind}{e.province ? ` · ${e.province}` : ""}</p>
                </div>
                <Icon name="arrowRight" size={16} className="mt-1 shrink-0 text-muted" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge status={located === e.campuses.length && located > 0 ? "active" : located ? "trialing" : "pending"}>
                  {located}/{e.campuses.length} campuses on the map
                </Badge>
                <Badge status={e.timetable_source_type === "none" ? "pending" : "active"}>{SOURCE[e.timetable_source_type] ?? e.timetable_source_type}</Badge>
              </div>
              {e.timetable_source_url && <p className="mt-2 truncate font-mono text-xs text-muted">{e.timetable_source_url}</p>}
              {e.timetable_note && <p className="mt-2 line-clamp-2 text-xs text-muted">{e.timetable_note}</p>}
            </Link>
          );
        })}
      </div>
    </>
  );
}
