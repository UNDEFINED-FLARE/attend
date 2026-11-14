import { Notice } from "@/components/ui";

/** Shown on a page whose feature the institution has switched off on the Design page. */
export function FeatureOff({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-lg pt-6">
      <Notice>{name} is switched off at your institution. Administrators can turn it on under Design → Features.</Notice>
    </div>
  );
}
