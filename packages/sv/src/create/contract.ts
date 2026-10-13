import * as v from 'valibot';

export const FileSchema = v.object({ name: v.string(), contents: v.string() });
export type File = v.InferOutput<typeof FileSchema>;
