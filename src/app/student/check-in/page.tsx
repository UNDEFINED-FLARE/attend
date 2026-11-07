import { CheckIn } from "./check-in";

export const metadata = { title: "Check in" };

export default async function Page({ searchParams }: { searchParams: Promise<{ s?: string; t?: string }> }) {
  const { s, t } = await searchParams;
  return <CheckIn initialSession={s ?? null} initialToken={t ?? null} />;
}
