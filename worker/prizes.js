// The Prize Booth. Edit this list to change prizes or prices; the site and the /prizes command read it.
//   id        stable key (stored on orders, so don't rename one that people have bought)
//   needs     'note': the member adds a short note (which game, what to draw…)
//             'game': the member picks a game from the poll catalog (kept for old orders; no prize uses it now)
//   noteLabel what the note box asks, and notePlaceholder an example
//   limit     most of this prize one member can have waiting at once
//   cap       most of this prize that can be ordered by everyone together in a calendar quarter (Eastern); null = no cap
//   group     prizes in the same group share one per-member allowance, `perMember` orders per quarter ('real' = costs real money)
//   gate      lifetime Slivers a member must have won before they can buy it (their coin tier follows lifetime Slivers)
//   pending   true = shown but not for sale yet (waiting for the person's OK); remove the flag to open it
//   kind      'draw': each order is one entry in the quarter's drawing; 'double': the next game night pays double

export const PRIZES = [
  { id: 'steam-5', name: 'Steam game, $5 or less', cost: 3600, needs: 'note', limit: 1, cap: 6, group: 'real', perMember: 1,
    noteLabel: 'Which game? (a link to its Steam page)', blurb: 'A Steam game of your choice worth $5 or less, gifted to you.' },
  { id: 'steam-10', name: 'Steam game, $10 or less', cost: 7500, needs: 'note', limit: 1, cap: 4, group: 'real', perMember: 1,
    noteLabel: 'Which game? (a link to its Steam page)', blurb: 'A Steam game of your choice worth $10 or less, gifted to you.' },
  { id: 'gift-card-25', name: '$25 gift card', cost: 36000, needs: 'note', limit: 1, cap: 2, group: 'real', perMember: 1, gate: 24000,
    noteLabel: 'Which store? (Steam, Amazon, a food place…)', blurb: 'A $25 gift card to a place you pick. Needs The Closet coin.' },
  { id: 'tarot', name: 'Live tarot reading', cost: 5400, needs: 'note', limit: 1, cap: 3, pending: true,
    noteLabel: 'What do you want to ask the cards?', blurb: 'A live tarot reading from the Fortune Teller, about 15 minutes in voice.' },
  { id: 'artwork', name: 'Custom artwork', cost: 7500, needs: 'note', limit: 1, cap: 2,
    noteLabel: 'What should the RingMistress draw?', blurb: 'A piece of art from the RingMistress: your avatar, your character, your idea.' },
  { id: 'double-night', name: 'Sponsor a Double Night', cost: 2250, needs: null, limit: 3, kind: 'double',
    blurb: 'The next game night pays double check-in Slivers to everyone there. Only one Double Night per game night; extra ones wait for the next.' },
  { id: 'title-role', name: 'Permanent custom title', cost: 3600, needs: 'note', limit: 1,
    noteLabel: 'Your title (within reason, and readable)', blurb: 'A role with a name and colour of your choice, yours to keep.' },
  { id: 'golden-ticket', name: 'Golden Ticket drawing entry', cost: 1500, needs: null, limit: 5, perMember: 5, kind: 'draw',
    blurb: 'One entry in this quarter\'s drawing for a $25 gift card. Up to 5 entries each.' }
];

// Prizes that used to be in the booth. Not for sale any more, but old orders keep their names and still finish.
export const LEGACY_PRIZES = [
  { id: 'fan-favorite', name: 'Fan Favorite badge' },
  { id: 'pin-oddity', name: 'Pin an Oddity' },
  { id: 'ballot-pick', name: 'Put a game on the ballot' },
  { id: 'jackbox-opener', name: 'Call the first Jackbox game' },
  { id: 'name-color', name: 'Custom name colour' }
];

export const prizeById = (id) => PRIZES.find((p) => p.id === id) || null;
export const prizeName = (id) => prizeById(id)?.name || LEGACY_PRIZES.find((p) => p.id === id)?.name || id;
