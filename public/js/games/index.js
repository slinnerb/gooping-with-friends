import trivia from './trivia.js';
import drawguess from './drawguess.js';
import crazy from './crazy.js';
import quip from './quip.js';
import wavelength from './wavelength.js';
import mostlikely from './mostlikely.js';
import wyr from './wyr.js';

export const clientGames = {
  [trivia.id]: trivia,
  [drawguess.id]: drawguess,
  [crazy.id]: crazy,
  [quip.id]: quip,
  [wavelength.id]: wavelength,
  [mostlikely.id]: mostlikely,
  [wyr.id]: wyr,
};
