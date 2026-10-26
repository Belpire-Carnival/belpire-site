// Explains why a login didn't get someone into the Members' Lounge. Only known reasons are shown.
const REASONS = {
  member: ['You’re not in the Belpire Carnival yet.', 'Your Discord account isn’t a member of the server. Join it, then log in again.'],
  role: ['Almost there.', 'Head to the Welcome Zone in Discord and accept the rules to get your role, then log in again.'],
  expired: ['That login took too long.', 'For security, logins expire after a few minutes. Please try again.'],
  error: ['Discord didn’t answer.', 'Something went wrong talking to Discord. Please try again in a minute.'],
  setup: ['The Lounge isn’t open yet.', 'Discord login is still being set up. Check back soon.']
};

document.addEventListener('DOMContentLoaded', () => {
  const reason = new URLSearchParams(location.search).get('reason');
  const msg = Object.prototype.hasOwnProperty.call(REASONS, reason) ? REASONS[reason] : null;
  if (!msg) return;
  document.getElementById('denied-title').textContent = msg[0];
  document.getElementById('denied-text').textContent = msg[1];
});
