import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** Hash the actual installed dependency bytes, not just their lockfile. */
export function treeDigest(directory: string): string {
  const root = realpathSync(directory), hash = createHash("sha256");
  const visit = (path: string) => {
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name), info = lstatSync(file);
      const key = relative(root, file).split(sep).join("/");
      if (info.isSymbolicLink()) {
        const target = realpathSync(file);
        if (target !== root && !target.startsWith(root + sep)) throw new Error(`Bundle dependency link escapes its directory: ${key}`);
        hash.update("link\0" + key + "\0" + readlinkSync(file) + "\0");
      } else if (info.isDirectory()) {
        hash.update("directory\0" + key + "\0"); visit(file);
      } else if (info.isFile()) {
        hash.update("file\0" + key + "\0" + info.size + "\0").update(readFileSync(file));
      } else throw new Error(`Unsupported bundle entry: ${key}`);
    }
  };
  visit(resolve(root));
  return hash.digest("hex");
}
