import type { CategoryInfo } from './types';

/**
 * Every category in the library. The clues themselves live in categories/<id>.json and load on
 * demand, so this list is all the builder needs to draw its picker.
 */
export const CATEGORIES: readonly CategoryInfo[] = [
  // Entertainment
  {
    id: 'famous-actors',
    name: 'Famous Actors',
    group: 'Entertainment',
    blurb: 'Roles, awards, "who played…"',
  },
  {
    id: 'name-that-movie',
    name: 'Name That Movie',
    group: 'Entertainment',
    blurb: 'A plot described without the title',
  },
  {
    id: 'tv-sitcoms',
    name: 'TV Sitcoms',
    group: 'Entertainment',
    blurb: 'Shows, characters, catchphrases',
  },
  {
    id: 'cartoons-animation',
    name: 'Cartoons & Animation',
    group: 'Entertainment',
    blurb: 'Saturday mornings to modern animated films',
  },
  {
    id: 'oscar-night',
    name: 'Oscar Night',
    group: 'Entertainment',
    blurb: 'Awards, directors, behind-the-scenes Hollywood',
  },
  {
    id: 'superheroes-comics',
    name: 'Superheroes & Comics',
    group: 'Entertainment',
    blurb: 'Heroes, villains, origin stories',
  },
  { id: 'anime', name: 'Anime', group: 'Entertainment', blurb: 'Studios, series, characters' },
  {
    id: 'horror-movies',
    name: 'Horror Movies',
    group: 'Entertainment',
    blurb: 'Slashers, classics, final girls',
  },
  {
    id: 'naruto',
    name: 'Naruto',
    group: 'Entertainment',
    blurb: 'Ninja, jutsu, the Hidden Leaf Village',
  },
  {
    id: 'one-piece',
    name: 'One Piece',
    group: 'Entertainment',
    blurb: 'Pirates, Devil Fruits, the Grand Line',
  },
  {
    id: 'dino',
    name: 'Dino',
    group: 'Entertainment',
    blurb: "Adults only. Don't ask.",
  },

  // Franchises
  {
    id: 'harry-potter',
    name: 'Harry Potter',
    group: 'Franchises',
    blurb: 'Houses, spells, books and films',
  },
  {
    id: 'star-wars',
    name: 'Star Wars',
    group: 'Franchises',
    blurb: 'Jedi, Sith, planets and the sequels',
  },
  {
    id: 'marvel-movies',
    name: 'Marvel Movies',
    group: 'Franchises',
    blurb: 'Avengers, phases, post-credit scenes',
  },
  {
    id: 'lord-of-the-rings',
    name: 'Lord of the Rings',
    group: 'Franchises',
    blurb: 'Middle-earth, the Hobbit, the films',
  },
  {
    id: 'pokemon',
    name: 'Pokémon',
    group: 'Franchises',
    blurb: 'Types, evolutions, gym leaders, the games',
  },
  {
    id: 'mario-nintendo',
    name: 'Mario & Nintendo',
    group: 'Franchises',
    blurb: 'Mario, Zelda, Smash Bros, consoles',
  },
  {
    id: 'disney-pixar',
    name: 'Disney & Pixar',
    group: 'Franchises',
    blurb: 'Princesses, sidekicks, villains, soundtracks',
  },
  {
    id: 'the-simpsons',
    name: 'The Simpsons',
    group: 'Franchises',
    blurb: 'Springfield, the family, the town oddballs',
  },
  {
    id: 'streaming-hits',
    name: 'Streaming Hits',
    group: 'Franchises',
    blurb: 'Stranger Things, Squid Game, Breaking Bad and co',
  },
  {
    id: 'the-office',
    name: 'The Office',
    group: 'Franchises',
    blurb: 'Dunder Mifflin, Michael Scott, pranks',
  },
  {
    id: 'game-of-thrones',
    name: 'Game of Thrones',
    group: 'Franchises',
    blurb: 'Houses, Westeros, dragons and deaths',
  },
  {
    id: 'stranger-things',
    name: 'Stranger Things',
    group: 'Franchises',
    blurb: 'Hawkins, the Upside Down, Eleven and the gang',
  },
  {
    id: 'friends',
    name: 'Friends',
    group: 'Franchises',
    blurb: 'Central Perk, the six friends, The One With…',
  },
  {
    id: 'legend-of-zelda',
    name: 'The Legend of Zelda',
    group: 'Franchises',
    blurb: 'Hyrule, Link, the Triforce and the games',
  },

  // Music
  {
    id: 'bands-artists',
    name: 'Bands & Artists',
    group: 'Music',
    blurb: "Who's who by facts, never lyrics",
  },
  {
    id: 'chart-toppers',
    name: 'Chart Toppers',
    group: 'Music',
    blurb: '#1 hits, albums, record-setters',
  },
  {
    id: 'hip-hop-rnb',
    name: 'Hip-Hop & R&B',
    group: 'Music',
    blurb: 'Pioneers, albums, records. Facts, not lyrics',
  },
  {
    id: 'trap',
    name: 'Trap',
    group: 'Music',
    blurb: 'Atlanta, 808s, Travis Scott and Migos',
  },
  { id: 'drake', name: 'Drake', group: 'Music', blurb: 'Albums, collabs, Toronto' },
  {
    id: 'kanye-west',
    name: 'Kanye West',
    group: 'Music',
    blurb: 'Albums, collabs, producer days',
  },
  {
    id: 'classic-rock',
    name: 'Classic Rock',
    group: 'Music',
    blurb: 'Bands, albums, legends. Facts, not lyrics',
  },
  {
    id: 'taylor-swift',
    name: 'Taylor Swift',
    group: 'Music',
    blurb: 'Eras, albums, Easter eggs and the Swifties',
  },

  // Nostalgia
  { id: 'the-90s', name: 'The 90s', group: 'Nostalgia', blurb: 'Music, TV, toys, tech and fads' },
  {
    id: 'y2k',
    name: 'Y2K',
    group: 'Nostalgia',
    blurb: 'The 2000s, from flip phones to early YouTube',
  },
  {
    id: 'childhood-toys',
    name: 'Childhood Toys',
    group: 'Nostalgia',
    blurb: 'Toys, crazes and playground classics',
  },

  // Games
  { id: 'video-games', name: 'Video Games', group: 'Games', blurb: 'Retro arcade to modern hits' },
  {
    id: 'board-card-games',
    name: 'Board & Card Games',
    group: 'Games',
    blurb: 'Classics, rules, history',
  },
  {
    id: 'league-of-legends',
    name: 'League of Legends',
    group: 'Games',
    blurb: 'Champions, lore, esports',
  },
  {
    id: 'minecraft',
    name: 'Minecraft',
    group: 'Games',
    blurb: 'Mobs, blocks, the Nether and the End',
  },
  {
    id: 'fortnite',
    name: 'Fortnite',
    group: 'Games',
    blurb: 'Battle Royale, skins, live events',
  },
  {
    id: 'call-of-duty',
    name: 'Call of Duty',
    group: 'Games',
    blurb: 'Maps, Zombies, killstreaks, studios',
  },
  {
    id: 'valorant',
    name: 'Valorant',
    group: 'Games',
    blurb: 'Agents, maps, weapons, esports',
  },

  // Internet & Tech
  {
    id: 'tech-internet',
    name: 'Tech & Internet',
    group: 'Internet & Tech',
    blurb: 'Gadgets, websites, the digital age',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    group: 'Internet & Tech',
    blurb: 'The app, the trends, the creators',
  },
  {
    id: 'memes-viral',
    name: 'Memes & Viral Moments',
    group: 'Internet & Tech',
    blurb: 'Classic memes, viral videos, internet history',
  },
  {
    id: 'youtubers-streamers',
    name: 'YouTubers & Streamers',
    group: 'Internet & Tech',
    blurb: 'Creators, Twitch, YouTube history',
  },

  // Science & Nature
  {
    id: 'animal-kingdom',
    name: 'Animal Kingdom',
    group: 'Science & Nature',
    blurb: 'Pets, wildlife, weird facts',
  },
  {
    id: 'space-planets',
    name: 'Space & Planets',
    group: 'Science & Nature',
    blurb: 'Planets, missions, astronomy',
  },
  {
    id: 'human-body',
    name: 'The Human Body',
    group: 'Science & Nature',
    blurb: 'Organs, bones, how things work',
  },
  {
    id: 'dinosaurs-prehistory',
    name: 'Dinosaurs & Prehistory',
    group: 'Science & Nature',
    blurb: 'Dinosaurs, fossils, the Ice Age',
  },
  {
    id: 'chemistry',
    name: 'Chemistry',
    group: 'Science & Nature',
    blurb: 'Elements, reactions, the periodic table',
  },
  {
    id: 'weather-disasters',
    name: 'Weather & Disasters',
    group: 'Science & Nature',
    blurb: 'Storms, quakes, scales and famous disasters',
  },

  // World
  {
    id: 'capitals-countries',
    name: 'Capitals & Countries',
    group: 'World',
    blurb: 'Capitals, landmarks, borders',
  },
  {
    id: 'canada',
    name: 'Canada',
    group: 'World',
    blurb: 'Provinces, cities, geography, landmarks',
  },
  {
    id: 'winnipeg',
    name: 'Winnipeg',
    group: 'World',
    blurb: 'The Peg: history, places, teams, trivia',
  },
  {
    id: 'landmarks-wonders',
    name: 'Landmarks & Wonders',
    group: 'World',
    blurb: 'Monuments, ancient and modern wonders',
  },
  {
    id: 'united-states',
    name: 'The United States',
    group: 'World',
    blurb: 'States, cities, landmarks, nicknames',
  },
  {
    id: 'europe',
    name: 'Europe',
    group: 'World',
    blurb: 'Capitals, rivers, countries, landmarks',
  },
  {
    id: 'canadian-pop-culture',
    name: 'Canadian Pop Culture',
    group: 'World',
    blurb: 'Musicians, actors, TV and movies',
  },

  // History & Myth
  {
    id: 'history-buffs',
    name: 'History Buffs',
    group: 'History & Myth',
    blurb: 'Events, eras and figures, world and US',
  },
  {
    id: 'myths-legends',
    name: 'Myths & Legends',
    group: 'History & Myth',
    blurb: 'Greek, Roman and Norse',
  },
  {
    id: 'inventions-firsts',
    name: 'Inventions & Firsts',
    group: 'History & Myth',
    blurb: 'Who invented it, and who did it first',
  },

  // Arts & Culture
  {
    id: 'art-artists',
    name: 'Art & Artists',
    group: 'Arts & Culture',
    blurb: 'Paintings, painters, movements',
  },
  {
    id: 'holidays-traditions',
    name: 'Holidays & Traditions',
    group: 'Arts & Culture',
    blurb: 'Origins and customs, around the year',
  },

  // Food & Brands
  {
    id: 'food-cooking',
    name: 'Food & Cooking',
    group: 'Food & Brands',
    blurb: 'Dishes, ingredients, cuisines',
  },
  {
    id: 'fast-food-snacks',
    name: 'Fast Food & Snacks',
    group: 'Food & Brands',
    blurb: 'Chains, candy, cereal, slogans',
  },
  {
    id: 'cars',
    name: 'Cars',
    group: 'Food & Brands',
    blurb: 'Brands, models, car culture (no racing)',
  },
  {
    id: 'drinks-cocktails',
    name: 'Drinks & Cocktails',
    group: 'Food & Brands',
    blurb: 'Cocktails, coffee, beer, wine and spirits',
  },

  // Sports
  { id: 'sports', name: 'Sports', group: 'Sports', blurb: 'Leagues, records, rules, Olympics' },
  { id: 'nhl', name: 'NHL', group: 'Sports', blurb: 'Teams, legends, the Stanley Cup' },
  { id: 'nba', name: 'NBA', group: 'Sports', blurb: 'Teams, legends, the Finals' },
  { id: 'nfl', name: 'NFL', group: 'Sports', blurb: 'Teams, Super Bowls, quarterbacks' },
  {
    id: 'soccer',
    name: 'Soccer',
    group: 'Sports',
    blurb: 'Clubs, tournaments, legends, the World Cup',
  },
  {
    id: 'gym-culture',
    name: 'Gym Culture',
    group: 'Sports',
    blurb: 'Lifts, bodybuilding legends, gym lingo',
  },
  {
    id: 'pro-wrestling',
    name: 'Pro Wrestling',
    group: 'Sports',
    blurb: 'WWE, WrestleMania, legends, finishers and lingo',
  },

  // Words & Books
  {
    id: 'books-authors',
    name: 'Books & Authors',
    group: 'Words & Books',
    blurb: 'Classics to bestsellers',
  },
  {
    id: 'word-play',
    name: 'Word Play',
    group: 'Words & Books',
    blurb: '"Before & After", word origins, spelling traps',
  },
];

/** Category groups in the order they appear, for the picker. */
export const GROUPS: readonly string[] = [...new Set(CATEGORIES.map((c) => c.group))];

export function findCategory(id: string): CategoryInfo | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

/** Match a board's column back to its library category by name, ignoring case. */
export function findCategoryByName(name: string): CategoryInfo | undefined {
  const wanted = name.trim().toLowerCase();
  return CATEGORIES.find((c) => c.name.toLowerCase() === wanted);
}
