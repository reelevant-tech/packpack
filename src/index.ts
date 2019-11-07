/* @flow */

import { walk, readFile, realpath } from './fs-utils';
import {sortFilter, ignoreLinesToRegex, filterOverridenGitignores, IgnoreFilter} from './utils';

import * as zlib from 'zlib'
import * as path from 'path'
import * as tar from 'tar-fs'
import * as fs2 from 'fs'
import depsFor from 'hash-for-dep/lib/deps-for'

const FOLDERS_IGNORE = [
  // never allow version control folders
  '.git',
  'CVS',
  '.svn',
  '.hg',

  'node_modules',
];

type Config = {
  cwd: string
}

const DEFAULT_IGNORE = ignoreLinesToRegex([
  ...FOLDERS_IGNORE,

  // ignore cruft
  'yarn.lock',
  '.lock-wscript',
  '.wafpickle-{0..9}',
  '*.swp',
  '._*',
  'npm-debug.log',
  'yarn-error.log',
  '.npmrc',
  '.yarnrc',
  '.npmignore',
  '.gitignore',
  '.DS_Store',
])

const NEVER_IGNORE = ignoreLinesToRegex([
  // never ignore these files
  '!/package.json',
  '!/readme*',
  '!/+(license|licence)*',
  '!/+(changes|changelog|history)*',
])

export async function packTarball(
  config: Config
): Promise<NodeJS.ReadableStream> {
  const pkg = require(path.resolve(config.cwd, 'package.json'))
  const { dependencies, main, files: onlyFiles} = pkg;

  // include required files
  let filters: Array<IgnoreFilter> = NEVER_IGNORE.slice()
  // include default filters unless `files` is used
  if (!onlyFiles) {
    filters = filters.concat(DEFAULT_IGNORE)
  }
  if (main && !onlyFiles) {
    filters = filters.concat(ignoreLinesToRegex(['!/' + main]))
  }

  // include all dependencies
  let bundleDependenciesFiles = [];
  const bundleDependencies = Object.keys(dependencies)
  if (bundleDependencies) {
    for (const dependency of bundleDependencies) {
      const dependencyList = depsFor(dependency, config.cwd)
      for (const dep of dependencyList) {
        const filesForBundledDep = await walk(dep.baseDir, null, new Set(FOLDERS_IGNORE))
        bundleDependenciesFiles = bundleDependenciesFiles.concat(filesForBundledDep)
      }
    }
  }

  // `files` field
  if (onlyFiles) {
    let lines = [
      '*', // ignore all files except those that are explicitly included with a negation filter
    ];
    lines = lines.concat(
      onlyFiles.map((filename: string): string => `!${filename}`),
      onlyFiles.map((filename: string): string => `!${path.join(filename, '**')}`),
    )
    const regexes = ignoreLinesToRegex(lines, './')
    filters = filters.concat(regexes)
  }

  const files = await walk(config.cwd, null, new Set(FOLDERS_IGNORE))
  const dotIgnoreFiles = filterOverridenGitignores(files)

  // create ignores
  for (const file of dotIgnoreFiles) {
    const raw = await readFile(file.absolute, { encoding: 'utf-8' })
    const lines = raw.split('\n')

    const regexes = ignoreLinesToRegex(lines, path.dirname(file.relative))
    filters = filters.concat(regexes)
  }

  // files to definitely keep, takes precedence over ignore filter
  const keepFiles: Set<string> = new Set()

  // files to definitely ignore
  const ignoredFiles: Set<string> = new Set()

  // list of files that didn't match any of our patterns, if a directory in the chain above was matched
  // then we should inherit it
  const possibleKeepFiles: Set<string> = new Set()

  // apply filters
  sortFilter(files, filters, keepFiles, possibleKeepFiles, ignoredFiles)

  // add the files for the bundled dependencies to the set of files to keep
  for (const file of bundleDependenciesFiles) {
    const realPath = await realpath(config.cwd)
    keepFiles.add(path.relative(realPath, file.absolute))
  }

  return packWithIgnoreAndHeaders(
    config.cwd,
    keepFiles,
    (header: { name: string }) => {
      if (header.name.includes(`../../node_modules`)) {
        header.name = header.name.replace('../../node_modules', 'node_modules')
      }
      return header
    },
  )
}

function packWithIgnoreAndHeaders(
  cwd: string,
  filesTooKep: Set<string>,
  mapHeader: (input: Object) => any,
): NodeJS.ReadableStream {
  return tar.pack(cwd, {
    entries: Array.from(filesTooKep),
    map: header => {
      const suffix = header.name === '.' ? '' : `/${header.name}`;
      header.name = `package${suffix}`;
      delete header.uid;
      delete header.gid;
      return mapHeader ? mapHeader(header) : header;
    },
  })
}

export async function pack(config: Config): Promise<NodeJS.ReadWriteStream> {
  const packer = await packTarball(config)
  const compressor = packer.pipe(zlib.createGzip())

  return compressor;
}

export async function run(
  config: Config,
  flags: {filename?: string}
): Promise<void> {
  const pkg = require(path.resolve(config.cwd, 'package.json'))
  if (!pkg.name) {
    throw new Error(`No name found for pkg.json`)
  }
  if (!pkg.version) {
    throw new Error(`No version found for pkg.json`)
  }

  const normaliseScope = name => (name[0] === '@' ? name.substr(1).replace('/', '-') : name)
  const filename = flags.filename || path.join(config.cwd, `${normaliseScope(pkg.name)}-v${pkg.version}.tgz`)

  const stream = await pack(config)

  await new Promise((resolve, reject) => {
    stream.pipe(fs2.createWriteStream(filename))
    stream.on('error', reject)
    stream.on('close', resolve)
  })

  console.log(`Successfully wrote tarball to ${filename}`)
}