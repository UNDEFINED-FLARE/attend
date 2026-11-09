import { z } from "zod";

// A campus as the super admin edits it (directory entries and institution setup).
const ll = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

export const CampusSchema = z.object({
  name: z.string().trim().min(2).max(120),
  town: z.string().trim().max(120).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  zoom: z.number().int().min(3).max(20).default(16),
  outline: z.array(ll).min(3).max(500).nullable().optional(),
  osm: z.string().regex(/^(node|way|relation)\/\d+$/).nullable().optional(),
  located: z.boolean().optional(),
});
export type CampusInput = z.infer<typeof CampusSchema>;
