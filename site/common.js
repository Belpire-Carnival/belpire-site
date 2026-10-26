// Shared by every page: the Discord invite link and the login button state.
// ▶ Set your permanent Discord invite here (Server Settings › Invites › never expire).
const DISCORD_INVITE = 'https://discord.gg/belpire';

function setDiscordLinks() {
  for (const a of document.querySelectorAll('[data-discord]')) {
    a.href = DISCORD_INVITE;
    a.target = '_blank';
    a.rel = 'noopener';
  }
}

// Log in with Discord  ⇄  Enter the Lounge, plus the member's name/avatar where a page asks for it.
async function setAuthState() {
  let me = { loggedIn: false, loginEnabled: true };
  try {
    const res = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
    if (res.ok) me = await res.json();
  } catch {
    /* offline or API unavailable: keep the login buttons as they are */
  }
  for (const el of document.querySelectorAll('[data-auth]')) {
    if (me.loggedIn) {
      el.textContent = "Enter the Members' Lounge";
      el.href = '/members/';
    } else if (me.loginEnabled === false) {
      el.hidden = true;
    }
  }
  if (me.loggedIn) {
    for (const el of document.querySelectorAll('[data-user-name]')) el.textContent = me.name;
    for (const img of document.querySelectorAll('img[data-user-avatar]')) {
      try {
        const u = new URL(me.avatar);
        if (u.protocol === 'https:' && u.hostname === 'cdn.discordapp.com') {
          img.src = u.href;
          img.hidden = false;
        }
      } catch {
        /* ignore bad avatar URL */
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setDiscordLinks();
  setAuthState();
  for (const el of document.querySelectorAll('[data-year]')) el.textContent = String(new Date().getFullYear());
});
