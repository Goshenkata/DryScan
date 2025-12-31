declare module "glob-gitignore" {
  import type { GlobOptions } from "glob";
  export function glob(patterns: string | string[], options?: GlobOptions & { ignore?: string | string[] }): Promise<string[]>;
  export function sync(patterns: string | string[], options?: GlobOptions & { ignore?: string | string[] }): string[];
  export function hasMagic(patterns: string | string[], options?: GlobOptions): boolean;
  export default glob;
}
