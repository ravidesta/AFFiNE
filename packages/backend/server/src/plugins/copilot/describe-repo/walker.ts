import { promises as fs } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

import {
  MAX_FILES_PROCESSED,
  PER_FILE_SIZE_CAP_BYTES,
  TOTAL_SNIPPET_BUDGET_BYTES,
} from './types';

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.scala': 'scala',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.sql': 'sql',
  '.r': 'r',
  '.lua': 'lua',
  '.dart': 'dart',
  '.elm': 'elm',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.clj': 'clojure',
  '.hs': 'haskell',
  '.ml': 'ocaml',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

const MANIFEST_FILENAMES = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'cargo.toml',
  'gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'pubspec.yaml',
  'project.toml',
  'readme.md',
  'readme',
  'license',
  'license.md',
  'license.txt',
]);

const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.yarn',
  'vendor',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  'coverage',
  '.gradle',
]);

export interface WalkedFile {
  absPath: string;
  relPath: string;
  bytes: number;
  lang: string;
  snippet: string;
  isManifest: boolean;
}

export interface WalkResult {
  files: WalkedFile[];
  totalBytes: number;
  truncated: boolean;
}

export function detectLang(relPath: string): string | null {
  const name = relPath.split('/').pop()?.toLowerCase() ?? '';
  if (MANIFEST_FILENAMES.has(name)) {
    if (name.startsWith('readme')) return 'markdown';
    if (name.startsWith('license')) return 'text';
    return 'config';
  }
  const ext = extname(name).toLowerCase();
  return LANG_BY_EXT[ext] ?? null;
}

export function shouldSkipDir(dirName: string): boolean {
  return SKIP_DIR_NAMES.has(dirName) || dirName.startsWith('.');
}

export async function walkRepo(rootDir: string): Promise<WalkResult> {
  const collected: WalkedFile[] = [];
  let totalBytes = 0;
  let truncated = false;

  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;

      const rel = relative(rootDir, abs).split(sep).join('/');
      const lang = detectLang(rel);
      if (!lang) continue;

      const stat = await fs.stat(abs);
      if (stat.size > PER_FILE_SIZE_CAP_BYTES) continue;

      if (totalBytes + stat.size > TOTAL_SNIPPET_BUDGET_BYTES) {
        truncated = true;
        continue;
      }
      if (collected.length >= MAX_FILES_PROCESSED) {
        truncated = true;
        continue;
      }

      const buf = await fs.readFile(abs);
      if (buf.includes(0)) continue;
      const snippet = buf.toString('utf8');

      collected.push({
        absPath: abs,
        relPath: rel,
        bytes: stat.size,
        lang,
        snippet,
        isManifest: MANIFEST_FILENAMES.has(
          (rel.split('/').pop() ?? '').toLowerCase()
        ),
      });
      totalBytes += stat.size;
    }
  }

  collected.sort((a, b) => {
    if (a.isManifest !== b.isManifest) return a.isManifest ? -1 : 1;
    return a.relPath.localeCompare(b.relPath);
  });

  return { files: collected, totalBytes, truncated };
}
