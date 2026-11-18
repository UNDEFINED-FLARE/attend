import { redirect } from "next/navigation";

// Connections now live in the Integration Centre, one page per connection.
export default function Connections() {
  redirect("/admin/integrations");
}
