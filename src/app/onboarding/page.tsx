import { redirect } from "next/navigation";
import { ActionForm } from "@/components/form";
import { Card, CardTitle, Field, Input, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { applyForInstitution, relink } from "./actions";

export const metadata = { title: "Get set up" };

export default async function Onboarding() {
  const s = await getSession();
  if (!s) redirect("/login?next=/onboarding");
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader title="Get set up" subtitle={`Signed in as ${s.user.email}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>I am a student or lecturer</CardTitle>
          <p className="mb-4 text-sm text-muted">
            Your institution adds you by student or staff number and email. Once it has, your access appears here
            automatically. If it has just been added, check again.
          </p>
          <ActionForm action={relink} submit="Check again" pending="Checking…"><span /></ActionForm>
        </Card>
        <Card>
          <CardTitle>Register an institution</CardTitle>
          <p className="mb-4 text-sm text-muted">
            For institution administrators. Your application is reviewed by UniAttend before attendance can be
            taken; you can set up faculties, modules and venues in the meantime.
          </p>
          <ActionForm action={applyForInstitution} submit="Submit application" pending="Submitting…">
            <Field label="Institution name"><Input name="name" placeholder="University of …" required /></Field>
            <Field label="Short name" hint="Used in links. Lowercase, e.g. uni-north.">
              <Input name="slug" pattern="[a-z0-9][a-z0-9\-]{1,40}" required />
            </Field>
            <Field label="Contact email"><Input name="contact_email" type="email" defaultValue={s.user.email} required /></Field>
          </ActionForm>
        </Card>
      </div>
    </main>
  );
}
