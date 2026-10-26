// The box office: shows the Discord invite to visitors signed in with a verified Discord account.
// The invite itself is never in the page source; it comes from /api/invite for a valid session.

const MESSAGES = {
  unverified: 'Your Discord account isn’t verified yet. In Discord, open User Settings › My Account and verify your email, then try again.',
  cancelled: 'Discord sign-in was cancelled. No problem: try again whenever you’re ready.',
  expired: 'That sign-in took too long or was opened in another tab. Please try again.',
  error: 'Discord didn’t answer just now. Please try again in a minute.',
  setup: 'The box office is closed for a moment. Please try again later.'
};

function showStatus(text) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.hidden = false;
}

const isInvite = (u) => typeof u === 'string' && /^https:\/\/(discord\.gg|discord\.com\/invite)\/[A-Za-z0-9-]{2,32}$/.test(u);

async function load() {
  const status = new URLSearchParams(location.search).get('status');
  if (status && Object.hasOwn(MESSAGES, status)) showStatus(MESSAGES[status]);
  if (status) history.replaceState(null, '', location.pathname);

  try {
    const res = await fetch('/api/invite', { credentials: 'same-origin', cache: 'no-store' });
    if (res.status === 503) return showStatus(MESSAGES.setup);
    if (!res.ok) return; // signed out: the verify button is already showing
    const data = await res.json();
    if (!data.signedIn || !isInvite(data.invite)) return;
    document.getElementById('who').textContent = String(data.name || 'friend').slice(0, 64);
    document.getElementById('invite').href = data.invite;
    document.getElementById('signed-out').hidden = true;
    document.getElementById('signed-in').hidden = false;
  } catch {
    /* offline or blocked: leave the verify button in place */
  }
}

document.addEventListener('DOMContentLoaded', load);
