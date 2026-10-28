// The Prize Booth. Edit this list to change prizes or prices; the site and the /prizes command read it.
//   id      stable key (stored on orders, so don't rename one that people have bought)
//   needs   'note': the member adds a short note (which oddity, which colour…)
//           'game': the member picks a game from the poll catalog; a Ringleader sees it pre-ticked
//                   when opening the next poll, and the order completes when that poll opens
//   limit   most of this prize one member can have waiting at once

export const PRIZES = [
  { id: 'fan-favorite', name: 'Fan Favorite badge', cost: 150, needs: null, limit: 1, blurb: 'A ✦ next to your name on the Midway High Scores for a month.' },
  { id: 'pin-oddity', name: 'Pin an Oddity', cost: 200, needs: 'note', limit: 1, blurb: 'Your picture or clip pinned to the top of the Hall of Oddities for a week. Tell us which one.' },
  { id: 'ballot-pick', name: 'Put a game on the ballot', cost: 250, needs: 'game', limit: 1, blurb: 'Your pick goes on the next game night poll. The crowd still decides if it wins.' },
  { id: 'jackbox-opener', name: 'Call the first Jackbox game', cost: 250, needs: 'note', limit: 1, blurb: 'You choose the opening Jackbox game on the next Jackbox night.' },
  { id: 'name-color', name: 'Custom name colour', cost: 400, needs: 'note', limit: 1, blurb: 'A colour role of your choice for a week (within reason, and readable).' }
];

export const prizeById = (id) => PRIZES.find((p) => p.id === id) || null;
