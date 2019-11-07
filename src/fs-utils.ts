
import * as fs from 'fs';
import path from 'path';
import { promisify } from 'util'

export const readdir = promisify(fs.readdir);
export const lstat = promisify(fs.lstat)
export const realpath = promisify(fs.realpath)
export const readFile = promisify(fs.readFile)

export type WalkFiles = Array<{
  relative: string,
  absolute: string,
  basename: string,
  mtime: number,
}>;

export async function walk(
  dir: string,
  relativeDir: string,
  ignoreBasenames: Set<string> = new Set(),
): Promise<WalkFiles> {
  let files = [];

  let filenames = await readdir(dir);
  if (ignoreBasenames.size) {
    filenames = filenames.filter(name => !ignoreBasenames.has(name));
  }

  for (const name of filenames) {
    const relative = relativeDir ? path.join(relativeDir, name) : name;
    const loc = path.join(dir, name);
    const stat = await lstat(loc);

    files.push({
      relative,
      basename: name,
      absolute: loc,
      mtime: +stat.mtime,
    });

    if (stat.isDirectory()) {
      files = files.concat(await walk(loc, relative, ignoreBasenames));
    }
  }

  return files;
}
