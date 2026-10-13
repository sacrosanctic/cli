import * as v from 'valibot';

export const File = v.object({ name: v.string(), contents: v.string() });
export type File = v.InferOutput<typeof File>;
