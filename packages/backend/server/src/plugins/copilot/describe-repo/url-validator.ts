const ALLOWED_HOSTS = new Set([
  'github.com',
  'gitlab.com',
  'codeberg.org',
  'bitbucket.org',
  'git.sr.ht',
]);

export interface ValidatedRepoUrl {
  normalized: string;
  host: string;
}

export class RepoUrlError extends Error {
  constructor(
    public readonly reason:
      | 'invalid_url'
      | 'unsupported_protocol'
      | 'host_not_allowed'
      | 'malformed_path',
    message: string
  ) {
    super(message);
    this.name = 'RepoUrlError';
  }
}

export function validateRepoUrl(input: string): ValidatedRepoUrl {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new RepoUrlError('invalid_url', `Not a valid URL: ${input}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new RepoUrlError(
      'unsupported_protocol',
      `Only https:// repository URLs are supported (got ${parsed.protocol})`
    );
  }

  if (parsed.username || parsed.password) {
    throw new RepoUrlError(
      'unsupported_protocol',
      'URLs with embedded credentials are not allowed'
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw new RepoUrlError(
      'host_not_allowed',
      `Host ${host} is not in the allow-list (${[...ALLOWED_HOSTS].join(', ')})`
    );
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  if (!/^\/[^/\s]+\/[^/\s]+(\.git)?$/.test(path)) {
    throw new RepoUrlError(
      'malformed_path',
      `Path must look like /owner/repo or /owner/repo.git`
    );
  }

  const normalized = `${parsed.protocol}//${host}${path.endsWith('.git') ? path : `${path}.git`}`;
  return { normalized, host };
}

export const ALLOWED_REPO_HOSTS: ReadonlySet<string> = new Set(ALLOWED_HOSTS);
