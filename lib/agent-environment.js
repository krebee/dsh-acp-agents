/** Host environment minimization for untrusted ACP subprocesses.
 * Only ordinary OS/runtime discovery variables are inherited by default.
 * Provider credentials and custom environment settings must be configured
 * on the intended agent, rather than inherited across provider boundaries.
 */
const INHERITED = new Set([
  'PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PROGRAMFILES',
  'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)', 'COMMONPROGRAMW6432', 'PROGRAMDATA',
  'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR',
  'SHELL', 'TERM', 'LANG', 'LANGUAGE', 'TZ', 'USER', 'USERNAME', 'LOGNAME',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR', 'XDG_DATA_DIRS', 'XDG_CONFIG_DIRS',
  'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'XAUTHORITY',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'NIX_SSL_CERT_FILE',
]);

/** A complete, restricted child environment.
 * Blank omitted host keys because some vendored auth/probe/terminal launch
 * APIs merge the supplied environment over their own inherited environment.
 * A blank value overrides the original without copying the secret.
 * The main session additionally sets extendEnv:false at the spawn boundary.
 */
export function restrictedAgentEnvironment(explicit = {}, host = process.env, platform = process.platform) {
  const entries = new Map();
  for (const [key, value] of Object.entries(host || {})) {
    if (value === undefined) continue;
    const allowed = INHERITED.has(key.toUpperCase()) || /^LC_[A-Z_]+$/.test(key.toUpperCase());
    entries.set(key, allowed ? String(value) : '');
  }
  for (const [key, value] of Object.entries(explicit || {})) {
    if (value === undefined || value === null) continue;
    // Preserve the exact inherited spelling as well as the configured spelling.
    // Otherwise an intermediate Windows launcher merging process.env could
    // reintroduce a differently cased copy of the original credential.
    if (platform === 'win32') {
      for (const inheritedKey of entries.keys()) {
        if (inheritedKey.toUpperCase() === key.toUpperCase()) entries.set(inheritedKey, String(value));
      }
    }
    entries.set(key, String(value));
  }
  return Object.fromEntries(entries);
}
