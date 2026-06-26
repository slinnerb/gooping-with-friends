import trivia from './trivia.js';
import drawguess from './drawguess.js';
import crazy from './crazy.js';
import quip from './quip.js';
import wavelength from './wavelength.js';
import mostlikely from './mostlikely.js';
import wyr from './wyr.js';

// Register games here. Each module is a self-contained game.
export const games = [trivia, drawguess, quip, wavelength, mostlikely, wyr, crazy];

const byId = new Map(games.map((g) => [g.id, g]));

export function getGame(id) {
  return byId.get(id) || null;
}
