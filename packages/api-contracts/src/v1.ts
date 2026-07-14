import { z } from 'zod';
export const requestIdSchema = z.string().min(8).max(128);
export const cursorSchema = z.string().min(1).max(512).optional();
export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: requestIdSchema }),
});
export const paginationSchema = z.object({
  nextCursor: z.string().nullable(),
  items: z.array(z.unknown()),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
