import { ActionForm } from "@/components/form";
import { Field, Input } from "@/components/ui";
import { updatePassword } from "../actions";

export const metadata = { title: "Choose a new password" };

export default function Reset() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <ActionForm action={updatePassword} submit="Save password" pending="Saving…">
        <Field label="New password" hint="At least 10 characters.">
          <Input name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
      </ActionForm>
    </div>
  );
}
