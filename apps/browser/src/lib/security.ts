// What the shell says about a page's connection. The state always comes
// from Chromium (Tab.security, merlin_urls.h ShellSecurityState), never from
// the URL's scheme: a page whose certificate error the person proceeded past
// is https: and still dangerous.

export type SecurityBadge = {
  icon: 'lock' | 'exclamationmark.triangle' | 'exclamationmark.octagon' | 'info.circle';
  tone: 'siteSecure' | 'siteInsecure' | 'danger';
  /** What the badge says to VoiceOver, before what pressing it does. */
  label: string;
};

/**
 * The site badge for a Tab.security or Prompt.security value. Anything else
 * (an older engine, a state added later) claims nothing.
 */
export function securityBadge(state: string | undefined): SecurityBadge {
  switch (state) {
    case 'secure': return { icon: 'lock', tone: 'siteSecure', label: 'Connection is secure' };
    case 'insecure': return { icon: 'exclamationmark.triangle', tone: 'siteInsecure', label: 'Connection is not secure' };
    case 'dangerous': return { icon: 'exclamationmark.octagon', tone: 'danger',
      label: 'Dangerous: this site is flagged or its certificate is not valid' };
    case 'internal': return { icon: 'info.circle', tone: 'siteSecure', label: 'Merlin page' };
    default: return { icon: 'info.circle', tone: 'siteSecure', label: 'Checking the connection' };
  }
}
