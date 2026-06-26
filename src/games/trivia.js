import { pickSome, clamp, shuffle } from '../util.js';
import * as extra from './banks-extra.js';

const QUESTION_MS = 20000;
const REVEAL_MS = 6000;

// Selectable round lengths (number of questions). Shown as chips in the lobby.
const LENGTHS = [
  { id: 5, name: 'Short' },
  { id: 15, name: 'Regular' },
  { id: 30, name: 'Marathon' },
];
const DEFAULT_LENGTH = 15;

function normalizeLength(n) {
  return LENGTHS.some((l) => l.id === Number(n)) ? Number(n) : DEFAULT_LENGTH;
}

// Randomize answer positions so the correct option isn't always in the same spot.
export function shuffleQuestion(q) {
  const order = shuffle(q.options.map((_, i) => i));
  return {
    q: q.q,
    options: order.map((i) => q.options[i]),
    answer: order.indexOf(q.answer),
  };
}

// Categories shown in the lobby. "everything" is special: it mixes every bank.
const CATEGORIES = [
  { id: 'everything', name: 'A Bit of Everything', emoji: '🌍' },
  { id: 'custom', name: 'My Questions', emoji: '✍️' },
  { id: 'ww2', name: 'World War II', emoji: '🎖️' },
  { id: 'war', name: 'War & History', emoji: '⚔️' },
  { id: 'alcohol', name: 'Alcohol', emoji: '🥃' },
  { id: 'medical', name: 'Medical & Body', emoji: '🩺' },
  { id: 'usacanada', name: 'USA & Canada', emoji: '🍁' },
  { id: 'plumbing', name: 'Plumbing', emoji: '🚿' },
  { id: 'electrical', name: 'Electrical', emoji: '⚡' },
  { id: 'hvac', name: 'HVAC', emoji: '❄️' },
  { id: 'lol', name: 'League of Legends', emoji: '🎮' },
  { id: 'filth', name: 'Sex & Filth', emoji: '🍆', adult: true },
  { id: 'party', name: 'Booze & Bad Decisions', emoji: '🍺', adult: true },
  { id: 'gross', name: 'Gross & Grimy', emoji: '🤮', adult: true },
  { id: 'gk', name: 'Filthy General Knowledge', emoji: '🧠', adult: true },
  { id: 'screen', name: 'Screens & Speakers', emoji: '🎬', adult: true },
];

// Each question: { q, options: [4], answer: index }
const BANKS = {
  ww2: [
    { q: "In which year did World War II begin in Europe?", options: ["1939", "1936", "1941", "1945"], answer: 0 },
    { q: "World War II in Europe began with Germany's invasion of which country?", options: ["France", "Poland", "Austria", "Belgium"], answer: 1 },
    { q: "Which 1941 attack brought the United States into WWII?", options: ["Battle of Midway", "D-Day", "Pearl Harbor", "Battle of the Bulge"], answer: 2 },
    { q: "On what date did the attack on Pearl Harbor occur?", options: ["7 December 1941", "1 September 1939", "6 June 1944", "8 May 1945"], answer: 0 },
    { q: "The 1944 D-Day landings took place on the beaches of which region?", options: ["Sicily", "Normandy", "Crete", "Calais"], answer: 1 },
    { q: "On what date did the D-Day Normandy landings take place?", options: ["6 June 1944", "7 December 1941", "1 September 1939", "2 September 1945"], answer: 0 },
    { q: "Who was British Prime Minister for most of WWII?", options: ["Neville Chamberlain", "Clement Attlee", "Winston Churchill", "Anthony Eden"], answer: 2 },
    { q: "Who led the Soviet Union during WWII?", options: ["Vladimir Lenin", "Joseph Stalin", "Leon Trotsky", "Nikita Khrushchev"], answer: 1 },
    { q: "Who was US President for most of WWII?", options: ["Harry Truman", "Dwight Eisenhower", "Franklin D. Roosevelt", "Herbert Hoover"], answer: 2 },
    { q: "Which US President ordered the atomic bombings of Japan?", options: ["Franklin D. Roosevelt", "Harry Truman", "Dwight Eisenhower", "Woodrow Wilson"], answer: 1 },
    { q: "On which city was the first atomic bomb dropped?", options: ["Nagasaki", "Tokyo", "Hiroshima", "Kyoto"], answer: 2 },
    { q: "What was the second Japanese city struck by an atomic bomb?", options: ["Nagasaki", "Osaka", "Yokohama", "Kobe"], answer: 0 },
    { q: "What was the codename of the US program to build the atomic bomb?", options: ["Operation Overlord", "The Manhattan Project", "Operation Torch", "Project Trinity"], answer: 1 },
    { q: "What was the name of the B-29 that dropped the Hiroshima bomb?", options: ["Memphis Belle", "Enola Gay", "Bockscar", "Spirit of St. Louis"], answer: 1 },
    { q: "'Operation Overlord' was the codename for what?", options: ["The invasion of Italy", "The D-Day invasion of Normandy", "The bombing of Berlin", "The North Africa campaign"], answer: 1 },
    { q: "'Operation Barbarossa' (1941) was Germany's invasion of?", options: ["Britain", "The Soviet Union", "France", "Poland"], answer: 1 },
    { q: "Which brutal battle is seen as the turning point on the Eastern Front?", options: ["Stalingrad", "Berlin", "Warsaw", "Kiev"], answer: 0 },
    { q: "The Battle of Kursk (1943) was history's largest what?", options: ["Naval battle", "Tank battle", "Air raid", "Amphibious landing"], answer: 1 },
    { q: "The Battle of Britain (1940) was fought mainly where?", options: ["At sea", "In the air", "In the desert", "In the mountains"], answer: 1 },
    { q: "Germany's fast 'lightning war' tactic was called?", options: ["Blitzkrieg", "Anschluss", "Lebensraum", "Wehrmacht"], answer: 0 },
    { q: "The 1940 evacuation of Allied troops from France is known as?", options: ["Dunkirk", "Dieppe", "Arnhem", "Anzio"], answer: 0 },
    { q: "VE Day (Victory in Europe) is celebrated on?", options: ["8 May 1945", "6 June 1944", "15 August 1945", "11 November 1918"], answer: 0 },
    { q: "Japan formally surrendered aboard which US battleship?", options: ["USS Arizona", "USS Missouri", "USS Enterprise", "USS Iowa"], answer: 1 },
    { q: "Approximately how many Jews were murdered in the Holocaust?", options: ["Six million", "One million", "Twelve million", "Half a million"], answer: 0 },
    { q: "What was the largest Nazi concentration and extermination camp?", options: ["Dachau", "Auschwitz-Birkenau", "Treblinka", "Bergen-Belsen"], answer: 1 },
    { q: "At which February 1945 conference did Churchill, Roosevelt and Stalin meet?", options: ["Potsdam", "Yalta", "Tehran", "Casablanca"], answer: 1 },
    { q: "The three main Axis powers were Germany, Japan and?", options: ["Italy", "Spain", "Hungary", "Romania"], answer: 0 },
    { q: "Who was the Fascist dictator of Italy during WWII?", options: ["Francisco Franco", "Benito Mussolini", "Galeazzo Ciano", "Victor Emmanuel"], answer: 1 },
    { q: "The German battleship sunk by the British in 1941 was the?", options: ["Tirpitz", "Bismarck", "Graf Spee", "Scharnhorst"], answer: 1 },
    { q: "Which June 1942 naval battle was the turning point in the Pacific?", options: ["Midway", "Coral Sea", "Leyte Gulf", "Guadalcanal"], answer: 0 },
    { q: "Germany's last major western offensive (1944-45) is known as the?", options: ["Battle of the Bulge", "Battle of the Somme", "Operation Sea Lion", "Battle of Anzio"], answer: 0 },
    { q: "Which US general vowed 'I shall return' to the Philippines?", options: ["George Patton", "Douglas MacArthur", "Omar Bradley", "Mark Clark"], answer: 1 },
    { q: "Who was Supreme Allied Commander in Europe, directing D-Day?", options: ["Dwight Eisenhower", "Bernard Montgomery", "George Marshall", "Douglas MacArthur"], answer: 0 },
    { q: "The German field marshal nicknamed 'The Desert Fox' was?", options: ["Heinz Guderian", "Erwin Rommel", "Gerd von Rundstedt", "Wilhelm Keitel"], answer: 1 },
    { q: "The 1938 agreement appeasing Hitler over Czechoslovakia was the?", options: ["Munich Agreement", "Treaty of Versailles", "Locarno Pact", "Atlantic Charter"], answer: 0 },
    { q: "'Peace for our time' was famously declared by?", options: ["Winston Churchill", "Neville Chamberlain", "Edouard Daladier", "Lord Halifax"], answer: 1 },
    { q: "The 1939 Nazi-Soviet non-aggression pact is known as the?", options: ["Molotov-Ribbentrop Pact", "Anti-Comintern Pact", "Pact of Steel", "Tripartite Pact"], answer: 0 },
    { q: "Japanese pilots who carried out suicide attacks were called?", options: ["Samurai", "Kamikaze", "Ronin", "Banzai"], answer: 1 },
    { q: "Where did British codebreakers crack the German Enigma cipher?", options: ["Bletchley Park", "Scotland Yard", "Sandhurst", "Whitehall"], answer: 0 },
    { q: "Which mathematician was central to breaking the Enigma code?", options: ["Alan Turing", "Isaac Newton", "John von Neumann", "Bertrand Russell"], answer: 0 },
    { q: "Anne Frank and her family hid from the Nazis in which city?", options: ["Amsterdam", "Berlin", "Vienna", "Brussels"], answer: 0 },
    { q: "The US program supplying war materials to the Allies was called?", options: ["Lend-Lease", "The Marshall Plan", "The New Deal", "Cash and Carry"], answer: 0 },
    { q: "'Rosie the Riveter' symbolized?", options: ["Women in wartime factory work", "Army nurses", "Female pilots", "Codebreakers"], answer: 0 },
    { q: "The bloodiest beach for US forces on D-Day was codenamed?", options: ["Utah", "Omaha", "Gold", "Juno"], answer: 1 },
    { q: "The German 6th Army was destroyed and surrendered at?", options: ["Stalingrad", "Kharkov", "Smolensk", "Rostov"], answer: 0 },
    { q: "Which country famously remained neutral throughout WWII?", options: ["Switzerland", "Poland", "Norway", "Greece"], answer: 0 },
    { q: "The April 1942 US air raid on Tokyo was known as the?", options: ["Doolittle Raid", "Dresden Raid", "Dambusters Raid", "Ploesti Raid"], answer: 0 },
    { q: "The famous all-African-American US fighter unit was the?", options: ["Tuskegee Airmen", "Flying Tigers", "Eagle Squadron", "Black Sheep"], answer: 0 },
    { q: "US Marines used which Native American language as an unbreakable code?", options: ["Navajo", "Apache", "Cherokee", "Sioux"], answer: 0 },
    { q: "In what year did Hitler become Chancellor of Germany?", options: ["1933", "1939", "1929", "1936"], answer: 0 },
    { q: "The 1938 anti-Jewish pogrom called the 'Night of Broken Glass' was?", options: ["Kristallnacht", "Anschluss", "Blitzkrieg", "Putsch"], answer: 0 },
    { q: "The German term for their unified armed forces was the?", options: ["Wehrmacht", "Luftwaffe", "Kriegsmarine", "Gestapo"], answer: 0 },
    { q: "Germany's air force was called the?", options: ["Luftwaffe", "Wehrmacht", "Kriegsmarine", "Panzergruppe"], answer: 0 },
    { q: "The Nazi secret state police were known as the?", options: ["Gestapo", "SS", "SA", "Stasi"], answer: 0 },
    { q: "German submarines that menaced Atlantic convoys were called?", options: ["U-boats", "Destroyers", "Dreadnoughts", "Corvettes"], answer: 0 },
    { q: "The 1938 union of Germany and Austria was called the?", options: ["Anschluss", "Lebensraum", "Blitz", "Putsch"], answer: 0 },
    { q: "Operation Market Garden (1944) was fought mainly in?", options: ["The Netherlands", "Belgium", "Italy", "France"], answer: 0 },
    { q: "The longest continuous campaign of WWII was the Battle of the?", options: ["Atlantic", "Pacific", "Mediterranean", "Baltic"], answer: 0 },
    { q: "The siege of which Soviet city lasted nearly 900 days?", options: ["Leningrad", "Moscow", "Stalingrad", "Kiev"], answer: 0 },
    { q: "The British general nicknamed 'Monty' was?", options: ["Bernard Montgomery", "Harold Alexander", "Archibald Wavell", "Claude Auchinleck"], answer: 0 },
    { q: "The decisive 1942 North African battle won by the British was?", options: ["El Alamein", "Tobruk", "Kasserine", "Gazala"], answer: 0 },
    { q: "Which July-August 1945 conference set the post-war order in Germany?", options: ["Potsdam", "Yalta", "Tehran", "Cairo"], answer: 0 },
    { q: "The Allied invasion of which island preceded the invasion of Italy?", options: ["Sicily", "Sardinia", "Corsica", "Crete"], answer: 0 },
    { q: "The famous WWII flag-raising photograph was taken on?", options: ["Iwo Jima", "Okinawa", "Guadalcanal", "Saipan"], answer: 0 },
    { q: "The US general known as 'Old Blood and Guts' was?", options: ["George Patton", "Omar Bradley", "Mark Clark", "Courtney Hodges"], answer: 0 },
    { q: "Hitler died in April 1945 in his bunker in which city?", options: ["Berlin", "Munich", "Nuremberg", "Hamburg"], answer: 0 },
    { q: "FDR died in April 1945 and was succeeded as President by?", options: ["Harry Truman", "Dwight Eisenhower", "Henry Wallace", "George Marshall"], answer: 0 },
    { q: "The Nazi plan for the systematic murder of Europe's Jews was called the?", options: ["Final Solution", "Master Plan", "Total War", "Lebensraum"], answer: 0 },
    { q: "The United Nations was founded in which year?", options: ["1945", "1939", "1950", "1919"], answer: 0 },
    { q: "The German invasion of Poland that started the war occurred in?", options: ["September 1939", "June 1941", "May 1940", "December 1941"], answer: 0 },
    { q: "'The Few' praised by Churchill referred to?", options: ["RAF fighter pilots", "Royal Navy sailors", "Commandos", "Bomber crews"], answer: 0 },
    { q: "Which 1942-43 Pacific island campaign was a brutal turning point?", options: ["Guadalcanal", "Iwo Jima", "Okinawa", "Tarawa"], answer: 0 },
    { q: "The Warsaw Ghetto Uprising took place in what year?", options: ["1943", "1939", "1945", "1941"], answer: 0 },
    { q: "The quiet early period of the war in the West was nicknamed the?", options: ["Phoney War", "Cold War", "Great War", "Twilight War"], answer: 0 },
    { q: "Mussolini's Italy and Hitler's Germany formalized their alliance as the?", options: ["Pact of Steel", "Munich Pact", "Atlantic Charter", "Warsaw Pact"], answer: 0 },
    { q: "The German cipher machine cracked by the Allies was the?", options: ["Enigma", "Colossus", "Bombe", "Lorenz Mark I"], answer: 0 },
    { q: "'Ultra' was the Allied term for?", options: ["Intelligence from decrypted Axis messages", "A new tank", "A heavy bomber", "A radar system"], answer: 0 },
    { q: "The 1941 Atlantic Charter was agreed by Churchill and?", options: ["Roosevelt", "Stalin", "De Gaulle", "Truman"], answer: 0 },
    { q: "Pearl Harbor is located in which US state/territory?", options: ["Hawaii", "California", "Alaska", "Philippines"], answer: 0 },
    { q: "Which 1945 Pacific battle near Japan was among the war's bloodiest?", options: ["Okinawa", "Midway", "Coral Sea", "Wake Island"], answer: 0 },
  ],
  war: [
    { q: "In what year did World War I begin?", options: ["1914", "1910", "1918", "1912"], answer: 0 },
    { q: "WWI was sparked by the assassination of?", options: ["Archduke Franz Ferdinand", "Kaiser Wilhelm II", "Tsar Nicholas II", "Otto von Bismarck"], answer: 0 },
    { q: "Franz Ferdinand was assassinated in which city?", options: ["Sarajevo", "Vienna", "Belgrade", "Budapest"], answer: 0 },
    { q: "On what date did WWI fighting end (the Armistice)?", options: ["11 November 1918", "8 May 1945", "28 June 1919", "1 August 1914"], answer: 0 },
    { q: "The 1919 treaty that officially ended WWI was the Treaty of?", options: ["Versailles", "Vienna", "Trianon", "Brest-Litovsk"], answer: 0 },
    { q: "The longest battle of WWI was the Battle of?", options: ["Verdun", "The Somme", "Ypres", "Marne"], answer: 0 },
    { q: "The 1916 battle with around a million casualties was the Battle of the?", options: ["Somme", "Bulge", "Marne", "Argonne"], answer: 0 },
    { q: "The sinking of which liner in 1915 outraged the United States?", options: ["Lusitania", "Titanic", "Bismarck", "Maine"], answer: 0 },
    { q: "The United States entered WWI in which year?", options: ["1917", "1914", "1918", "1916"], answer: 0 },
    { q: "Germany, Austria-Hungary and the Ottomans formed the?", options: ["Central Powers", "Allied Powers", "Triple Entente", "Axis"], answer: 0 },
    { q: "The contested ground between opposing trenches was called?", options: ["No man's land", "The killing field", "The front porch", "The DMZ"], answer: 0 },
    { q: "The German flying ace called the 'Red Baron' was?", options: ["Manfred von Richthofen", "Hermann Goering", "Ernst Udet", "Max Immelmann"], answer: 0 },
    { q: "The informal 1914 'Christmas Truce' occurred on which front?", options: ["Western Front", "Eastern Front", "Italian Front", "Gallipoli"], answer: 0 },
    { q: "The Gallipoli campaign is especially remembered by which troops?", options: ["ANZAC (Australia & NZ)", "US Marines", "French Foreign Legion", "Gurkhas"], answer: 0 },
    { q: "The Zimmermann Telegram proposed a German alliance with?", options: ["Mexico", "Japan", "Spain", "Canada"], answer: 0 },
    { q: "WWI was originally known as?", options: ["The Great War", "The Cold War", "The World War", "The Long War"], answer: 0 },
    { q: "Which new armored weapon first saw major use in WWI?", options: ["The tank", "The helicopter", "The jet fighter", "The drone"], answer: 0 },
    { q: "The American Civil War was fought during which years?", options: ["1861-1865", "1775-1783", "1846-1848", "1898-1899"], answer: 0 },
    { q: "The American Civil War was between the Union and the?", options: ["Confederacy", "Redcoats", "Patriots", "Loyalists"], answer: 0 },
    { q: "Who was US President during the Civil War?", options: ["Abraham Lincoln", "George Washington", "Ulysses S. Grant", "Andrew Jackson"], answer: 0 },
    { q: "The decisive turning-point battle of the US Civil War (1863) was?", options: ["Gettysburg", "Antietam", "Bull Run", "Shiloh"], answer: 0 },
    { q: "The Cold War was a standoff mainly between the US and?", options: ["The Soviet Union", "China", "Germany", "Cuba"], answer: 0 },
    { q: "The Korean War took place during which years?", options: ["1950-1953", "1939-1945", "1965-1973", "1914-1918"], answer: 0 },
    { q: "Napoleon suffered his final defeat in 1815 at?", options: ["Waterloo", "Austerlitz", "Borodino", "Leipzig"], answer: 0 },
    { q: "The Hundred Years' War was fought between England and?", options: ["France", "Spain", "Scotland", "Germany"], answer: 0 },
    { q: "The 1991 Gulf War was launched to liberate which country?", options: ["Kuwait", "Iraq", "Iran", "Saudi Arabia"], answer: 0 },
    { q: "At which pass did 300 Spartans famously make their stand?", options: ["Thermopylae", "Marathon", "Salamis", "Troy"], answer: 0 },
    { q: "The Battle of Hastings, which transformed England, occurred in?", options: ["1066", "1215", "1314", "911"], answer: 0 },
    { q: "The medieval Crusades were fought largely over control of?", options: ["The Holy Land", "Spain", "Egypt", "Constantinople"], answer: 0 },
    { q: "The Vietnam War saw heavy US involvement mainly in which decade?", options: ["The 1960s", "The 1930s", "The 1980s", "The 1910s"], answer: 0 },
    { q: "The Battle of Trafalgar (1805) was a naval victory for?", options: ["Britain", "France", "Spain", "The Netherlands"], answer: 0 },
    { q: "The British admiral who died winning at Trafalgar was?", options: ["Horatio Nelson", "Francis Drake", "John Jervis", "Cuthbert Collingwood"], answer: 0 },
    { q: "The 1854 'Charge of the Light Brigade' happened during which war?", options: ["The Crimean War", "The Boer War", "World War I", "The Napoleonic Wars"], answer: 0 },
    { q: "Which wall divided a German city during the Cold War?", options: ["The Berlin Wall", "Hadrian's Wall", "The Great Wall", "The Maginot Line"], answer: 0 },
    { q: "The 1962 superpower nuclear standoff was the ___ Missile Crisis.", options: ["Cuban", "Berlin", "Korean", "Turkish"], answer: 0 },
    { q: "The English archers' deadly weapon at Agincourt (1415) was the?", options: ["Longbow", "Crossbow", "Musket", "Catapult"], answer: 0 },
    { q: "The ancient empire defeated by Rome in the Punic Wars was?", options: ["Carthage", "Greece", "Egypt", "Persia"], answer: 0 },
    { q: "The Carthaginian general who crossed the Alps with elephants was?", options: ["Hannibal", "Scipio", "Hamilcar", "Hasdrubal"], answer: 0 },
  ],
  alcohol: [
    { q: "Tequila is made from which plant?", options: ["Blue agave", "Cactus", "Sugarcane", "Corn"], answer: 0 },
    { q: "Champagne can only legally come from which region of France?", options: ["Champagne", "Bordeaux", "Burgundy", "Provence"], answer: 0 },
    { q: "Bourbon must be made from a mash of at least 51% which grain?", options: ["Corn", "Barley", "Rye", "Wheat"], answer: 0 },
    { q: "Scotch whisky must by law be made in?", options: ["Scotland", "Ireland", "England", "Wales"], answer: 0 },
    { q: "Which spirit is the base of a classic Mojito?", options: ["White rum", "Vodka", "Gin", "Tequila"], answer: 0 },
    { q: "Guinness is what style of beer?", options: ["Stout", "Lager", "Pilsner", "Wheat beer"], answer: 0 },
    { q: "What does the beer abbreviation IPA stand for?", options: ["India Pale Ale", "Irish Pale Ale", "Italian Premium Ale", "Imperial Pilsner Ale"], answer: 0 },
    { q: "The dominant flavoring botanical in gin is?", options: ["Juniper", "Anise", "Mint", "Coriander"], answer: 0 },
    { q: "Cognac is a type of which spirit?", options: ["Brandy", "Whiskey", "Rum", "Gin"], answer: 0 },
    { q: "Sake is a traditional alcoholic drink from which country?", options: ["Japan", "China", "Korea", "Vietnam"], answer: 0 },
    { q: "Rum is distilled mainly from sugarcane or?", options: ["Molasses", "Corn", "Barley", "Agave"], answer: 0 },
    { q: "Port wine comes from which country?", options: ["Portugal", "Spain", "Italy", "France"], answer: 0 },
    { q: "The process that converts sugar into alcohol is called?", options: ["Fermentation", "Distillation", "Oxidation", "Pasteurization"], answer: 0 },
    { q: "Hops are added to beer mainly for?", options: ["Bitterness and aroma", "Sweetness", "Color", "Fizz"], answer: 0 },
    { q: "A Margarita is tequila, lime juice and what else?", options: ["Orange liqueur", "Cola", "Cream", "Tonic"], answer: 0 },
    { q: "A Negroni is gin, sweet vermouth and?", options: ["Campari", "Cola", "Lime", "Soda water"], answer: 0 },
    { q: "Which spirit forms the base of a Bloody Mary?", options: ["Vodka", "Gin", "Rum", "Whiskey"], answer: 0 },
    { q: "In the US, a spirit labeled 80 proof contains how much alcohol?", options: ["40% ABV", "80% ABV", "20% ABV", "8% ABV"], answer: 0 },
    { q: "The Angel's share in whisky-making refers to?", options: ["Alcohol lost to evaporation while aging", "The first pour from the cask", "A charity tax", "The foam on a pour"], answer: 0 },
    { q: "Absinthe is traditionally flavored with anise and?", options: ["Wormwood", "Juniper", "Mint", "Vanilla"], answer: 0 },
    { q: "Vodka is most traditionally distilled from grain or?", options: ["Potatoes", "Grapes", "Agave", "Apples"], answer: 0 },
    { q: "Prosecco, the sparkling wine, comes from which country?", options: ["Italy", "Spain", "France", "Portugal"], answer: 0 },
    { q: "Cava, the sparkling wine, comes from which country?", options: ["Spain", "Italy", "France", "Chile"], answer: 0 },
    { q: "Mezcal, like tequila, is made from?", options: ["Agave", "Cactus", "Corn", "Rice"], answer: 0 },
    { q: "Mead is an alcoholic drink fermented from?", options: ["Honey", "Grapes", "Barley", "Apples"], answer: 0 },
    { q: "Wine is made by fermenting?", options: ["Grapes", "Barley", "Potatoes", "Honey"], answer: 0 },
    { q: "Beer is brewed mainly from malted?", options: ["Barley", "Grapes", "Rice paper", "Agave"], answer: 0 },
    { q: "A standard US shot is roughly how many fluid ounces?", options: ["1.5 oz", "0.5 oz", "3 oz", "5 oz"], answer: 0 },
    { q: "A US pint of beer is how many fluid ounces?", options: ["16 oz", "12 oz", "20 oz", "24 oz"], answer: 0 },
    { q: "The legal drinking age across the United States is?", options: ["21", "18", "19", "16"], answer: 0 },
    { q: "The drinking age in most Canadian provinces is?", options: ["18 or 19", "21", "16", "25"], answer: 0 },
    { q: "A dirty martini gets its name from a splash of?", options: ["Olive brine", "Cream", "Cola", "Lime juice"], answer: 0 },
    { q: "Which cocktail mixes vodka with ginger beer and lime?", options: ["Moscow Mule", "Margarita", "Negroni", "Daiquiri"], answer: 0 },
    { q: "Chardonnay is which color of wine grape?", options: ["White", "Red", "Rosé", "Black"], answer: 0 },
    { q: "Cabernet Sauvignon is a famous grape for which wine color?", options: ["Red", "White", "Sparkling", "Rosé"], answer: 0 },
    { q: "Vermouth is a fortified and aromatized?", options: ["Wine", "Beer", "Brandy", "Cider"], answer: 0 },
    { q: "Tennessee whiskey is mellowed through charcoal made from?", options: ["Sugar maple", "Oak", "Pine", "Coconut"], answer: 0 },
    { q: "Sangria is a party punch based on?", options: ["Wine", "Beer", "Vodka", "Rum"], answer: 0 },
    { q: "The strongest commonly sold grain spirit, around 95% ABV, is?", options: ["Everclear", "Smirnoff", "Bacardi", "Jim Beam"], answer: 0 },
    { q: "A dry wine is one that has very little?", options: ["Residual sugar", "Alcohol", "Acidity", "Color"], answer: 0 },
    { q: "Lager uses yeast that ferments cool at the?", options: ["Bottom of the tank", "Top of the tank", "Surface only", "Freezing point"], answer: 0 },
    { q: "Which country is famous for the most beer drunk per person?", options: ["Czech Republic", "United States", "Australia", "Brazil"], answer: 0 },
    { q: "Triple sec is what flavor of liqueur?", options: ["Orange", "Cherry", "Mint", "Coffee"], answer: 0 },
    { q: "A whiskey sour combines whiskey, sugar and?", options: ["Lemon juice", "Cola", "Cream", "Tonic"], answer: 0 },
    { q: "Which red wine grape is also known as Shiraz?", options: ["Syrah", "Merlot", "Malbec", "Pinot Noir"], answer: 0 },
    { q: "Calvados is a brandy made from which fruit?", options: ["Apples", "Grapes", "Cherries", "Pears"], answer: 0 },
  ],
  medical: [
    { q: "What is the largest organ of the human body?", options: ["The skin", "The liver", "The heart", "The lungs"], answer: 0 },
    { q: "How many chambers does the human heart have?", options: ["Four", "Two", "Three", "Six"], answer: 0 },
    { q: "The medical term for high blood pressure is?", options: ["Hypertension", "Hypotension", "Tachycardia", "Anemia"], answer: 0 },
    { q: "Which organ produces insulin?", options: ["The pancreas", "The liver", "The kidney", "The spleen"], answer: 0 },
    { q: "How many bones are in the adult human body?", options: ["206", "300", "150", "250"], answer: 0 },
    { q: "The smallest bones in the body are found in the?", options: ["Ear", "Nose", "Hand", "Foot"], answer: 0 },
    { q: "Red blood cells carry oxygen using which protein?", options: ["Hemoglobin", "Keratin", "Collagen", "Insulin"], answer: 0 },
    { q: "Which vitamin does skin make when exposed to sunlight?", options: ["Vitamin D", "Vitamin C", "Vitamin A", "Vitamin K"], answer: 0 },
    { q: "What does CPR stand for?", options: ["Cardiopulmonary resuscitation", "Cardiac pulse recovery", "Critical patient response", "Chest pressure routine"], answer: 0 },
    { q: "The body's largest artery is the?", options: ["Aorta", "Vena cava", "Carotid", "Femoral artery"], answer: 0 },
    { q: "Which blood type is the universal donor?", options: ["O negative", "AB positive", "A positive", "B negative"], answer: 0 },
    { q: "Which blood type is the universal recipient?", options: ["AB positive", "O negative", "A negative", "O positive"], answer: 0 },
    { q: "The funny bone tingle actually comes from which nerve?", options: ["Ulnar nerve", "Sciatic nerve", "Median nerve", "Vagus nerve"], answer: 0 },
    { q: "The medical term for a heart attack is?", options: ["Myocardial infarction", "Cardiac angina", "Arrhythmia", "Embolism"], answer: 0 },
    { q: "Antibiotics work against which type of germ?", options: ["Bacteria", "Viruses", "Allergens", "Toxins"], answer: 0 },
    { q: "Which gland controls metabolism via the hormone thyroxine?", options: ["Thyroid", "Adrenal", "Pituitary", "Pineal"], answer: 0 },
    { q: "The kneecap is also known as the?", options: ["Patella", "Femur", "Tibia", "Fibula"], answer: 0 },
    { q: "The collarbone is also called the?", options: ["Clavicle", "Scapula", "Sternum", "Humerus"], answer: 0 },
    { q: "A low red blood cell count is called?", options: ["Anemia", "Leukemia", "Hemophilia", "Sepsis"], answer: 0 },
    { q: "The brain and spinal cord make up the?", options: ["Central nervous system", "Circulatory system", "Lymphatic system", "Endocrine system"], answer: 0 },
    { q: "Normal human body temperature is about?", options: ["37°C (98.6°F)", "30°C (86°F)", "42°C (107°F)", "35°C (95°F)"], answer: 0 },
    { q: "Which organs filter the blood and make urine?", options: ["The kidneys", "The lungs", "The liver", "The heart"], answer: 0 },
    { q: "White blood cells are mainly responsible for?", options: ["Fighting infection", "Carrying oxygen", "Clotting", "Storing fat"], answer: 0 },
    { q: "Platelets in the blood mainly help with?", options: ["Clotting", "Carrying oxygen", "Fighting infection", "Digestion"], answer: 0 },
    { q: "The tube carrying food from the mouth to the stomach is the?", options: ["Esophagus", "Trachea", "Larynx", "Colon"], answer: 0 },
    { q: "A deficiency of vitamin C causes which disease?", options: ["Scurvy", "Rickets", "Anemia", "Goiter"], answer: 0 },
    { q: "A splenectomy is the surgical removal of the?", options: ["Spleen", "Stomach", "Gallbladder", "Kidney"], answer: 0 },
    { q: "How many teeth does a typical adult human have?", options: ["32", "28", "24", "36"], answer: 0 },
    { q: "A stroke is caused by interrupted blood flow to the?", options: ["Brain", "Heart", "Lungs", "Liver"], answer: 0 },
    { q: "Type 1 and Type 2 are forms of which condition?", options: ["Diabetes", "Cancer", "Hepatitis", "Asthma"], answer: 0 },
    { q: "Which part of the eye controls how much light gets in?", options: ["The iris", "The retina", "The cornea", "The eyelash"], answer: 0 },
    { q: "The largest internal organ is the?", options: ["Liver", "Brain", "Stomach", "Heart"], answer: 0 },
    { q: "Vital signs include temperature, pulse, breathing rate and?", options: ["Blood pressure", "Height", "Weight", "Eye color"], answer: 0 },
    { q: "An inflamed appendix that may need surgery is called?", options: ["Appendicitis", "Gastritis", "Hepatitis", "Colitis"], answer: 0 },
    { q: "How many lungs does the human body have?", options: ["Two", "One", "Three", "Four"], answer: 0 },
    { q: "Low blood sugar is medically called?", options: ["Hypoglycemia", "Hyperglycemia", "Hypoxia", "Hypothermia"], answer: 0 },
  ],
  usacanada: [
    { q: "The US-Canada border is the world's longest what?", options: ["International land border", "River", "Coastline", "Mountain range"], answer: 0 },
    { q: "Much of the western US-Canada border follows which line of latitude?", options: ["The 49th parallel", "The Equator", "The 38th parallel", "The Tropic of Cancer"], answer: 0 },
    { q: "Roughly how long is the US-Canada border?", options: ["About 8,900 km (5,500 mi)", "About 2,000 km", "About 20,000 km", "About 500 km"], answer: 0 },
    { q: "Which US state shares the longest border with Canada?", options: ["Alaska", "Michigan", "Maine", "Montana"], answer: 0 },
    { q: "Niagara Falls sits on the border of New York and which province?", options: ["Ontario", "Quebec", "Manitoba", "Alberta"], answer: 0 },
    { q: "The Peace Arch monument straddles the border of British Columbia and?", options: ["Washington", "Oregon", "Idaho", "Montana"], answer: 0 },
    { q: "Point Roberts, a US exclave, is only reachable by land through?", options: ["Canada", "Mexico", "A tunnel", "A ferry only"], answer: 0 },
    { q: "How many Great Lakes are there?", options: ["Five", "Three", "Four", "Seven"], answer: 0 },
    { q: "Which Great Lake lies entirely within the United States?", options: ["Lake Michigan", "Lake Erie", "Lake Ontario", "Lake Huron"], answer: 0 },
    { q: "The Detroit-Windsor crossing links the US to which province?", options: ["Ontario", "Quebec", "Manitoba", "Nova Scotia"], answer: 0 },
    { q: "Which country is larger by total area?", options: ["Canada", "United States", "They are exactly equal", "Neither is measured"], answer: 0 },
    { q: "What is the capital of the United States?", options: ["Washington, D.C.", "New York City", "Los Angeles", "Chicago"], answer: 0 },
    { q: "What is the capital of Canada?", options: ["Ottawa", "Toronto", "Vancouver", "Montreal"], answer: 0 },
    { q: "How many states make up the USA?", options: ["50", "48", "52", "51"], answer: 0 },
    { q: "How many provinces does Canada have?", options: ["Ten", "Thirteen", "Eight", "Twelve"], answer: 0 },
    { q: "Canada also has how many territories?", options: ["Three", "One", "Five", "Zero"], answer: 0 },
    { q: "The largest US state by area is?", options: ["Alaska", "Texas", "California", "Montana"], answer: 0 },
    { q: "The largest Canadian province by area is?", options: ["Quebec", "Ontario", "Alberta", "British Columbia"], answer: 0 },
    { q: "The most populous US state is?", options: ["California", "Texas", "New York", "Florida"], answer: 0 },
    { q: "The largest city in Canada by population is?", options: ["Toronto", "Montreal", "Vancouver", "Calgary"], answer: 0 },
    { q: "Canada's two official languages are English and?", options: ["French", "Spanish", "Inuktitut", "German"], answer: 0 },
    { q: "The Statue of Liberty stands in which US city?", options: ["New York City", "Boston", "Philadelphia", "Washington"], answer: 0 },
    { q: "The CN Tower is a landmark of which Canadian city?", options: ["Toronto", "Ottawa", "Montreal", "Vancouver"], answer: 0 },
    { q: "Mount Rushmore is carved in which US state?", options: ["South Dakota", "Wyoming", "Colorado", "Nevada"], answer: 0 },
    { q: "Which river forms much of the US-Mexico border?", options: ["Rio Grande", "Colorado River", "Mississippi River", "Pecos River"], answer: 0 },
    { q: "How many US states border Mexico?", options: ["Four", "Two", "Six", "Three"], answer: 0 },
    { q: "The longest river in Canada is the?", options: ["Mackenzie River", "St. Lawrence River", "Fraser River", "Yukon River"], answer: 0 },
    { q: "The longest river in the United States is generally the?", options: ["Missouri River", "Colorado River", "Hudson River", "Rio Grande"], answer: 0 },
    { q: "Canada's national animal is the?", options: ["Beaver", "Moose", "Polar bear", "Loon"], answer: 0 },
    { q: "Which Canadian city hosted the 2010 Winter Olympics?", options: ["Vancouver", "Calgary", "Toronto", "Montreal"], answer: 0 },
    { q: "The Canadian Rockies are mainly in Alberta and?", options: ["British Columbia", "Saskatchewan", "Manitoba", "Yukon"], answer: 0 },
    { q: "Which ocean lies to the north of Canada?", options: ["Arctic Ocean", "Pacific Ocean", "Atlantic Ocean", "Indian Ocean"], answer: 0 },
    { q: "The largest island in Canada is?", options: ["Baffin Island", "Vancouver Island", "Newfoundland", "Prince Edward Island"], answer: 0 },
    { q: "The Great Lakes are shared between Canada and the?", options: ["United States", "Mexico", "Greenland", "Russia"], answer: 0 },
    { q: "The trade deal NAFTA involved the US, Canada and?", options: ["Mexico", "Brazil", "Cuba", "The UK"], answer: 0 },
    { q: "Canada's currency is the?", options: ["Canadian dollar", "Pound", "Euro", "Peso"], answer: 0 },
  ],
  lol: [
    { q: "Which champ is the Nine-Tailed Fox who charms simps to their death?", options: ["Ahri", "Evelynn", "Akali", "Neeko"], answer: 0 },
    { q: "What does 'ADC' actually stand for?", options: ["Attack Damage Carry", "Always Dying Casually", "Absolutely Dogwater Champ", "Average Diff Crybaby"], answer: 0 },
    { q: "Soloing all 5 enemies is gloriously called a what?", options: ["Pentakill", "Quadrakill", "Bloodbath", "Gangbang"], answer: 0 },
    { q: "Which big purple worm do you slay in the river for the buff?", options: ["Baron Nashor", "The Dragon", "Rift Scuttle", "Teemo"], answer: 0 },
    { q: "Garen mains scream which word while pressing R in your face?", options: ["Demacia!", "Noxus!", "I have no skill!", "Mommy!"], answer: 0 },
    { q: "Which little rat plants invisible shrooms and ruins friendships?", options: ["Teemo", "Twitch", "Rammus", "Ziggs"], answer: 0 },
    { q: "'GG EZ' in all chat is usually typed by?", options: ["A toxic winner", "A humble monk", "Riot Games", "Your therapist"], answer: 0 },
    { q: "Which champ is literally a seductive demon in lingerie?", options: ["Evelynn", "Morgana", "Lillia", "Zyra"], answer: 0 },
    { q: "The LoL world championship is called?", options: ["Worlds", "The Olympics", "Coachella", "The Booty Bowl"], answer: 0 },
    { q: "Statistically, the average Yasuo main is?", options: ["0/10 and flaming", "Challenger god", "Touching grass", "Emotionally stable"], answer: 0 },
    { q: "Which lane do the ADC and Support share while bickering like exes?", options: ["Bot lane", "Top lane", "Mid lane", "The jungle"], answer: 0 },
    { q: "Last-hitting minions for gold is called?", options: ["Farming", "Camping", "Edging", "Grinding"], answer: 0 },
    { q: "Which champ throws a giant axe and screams about reckoning?", options: ["Darius", "Sett", "Aatrox", "Garen"], answer: 0 },
    { q: "Buying a Doran's Blade at the start means you're going?", options: ["Aggressive lane", "AFK", "Full support", "To therapy"], answer: 0 },
  ],
  filth: [
    { q: "What's the fancy medical term for 'morning wood'?", options: ["Nocturnal penile tumescence", "The dawn salute", "Sunrise stiffy", "Morning glory"], answer: 0 },
    { q: "Roughly how many nerve endings does the clitoris have?", options: ["~8,000", "Twelve", "One, if you're lucky", "Five hundred"], answer: 0 },
    { q: "Besides humans, which animal famously bangs for fun?", options: ["Bonobos", "Pigeons", "Sloths", "Wasps"], answer: 0 },
    { q: "'Blue balls' has an actual medical name. What is it?", options: ["Epididymal hypertension", "Smurf syndrome", "Frostbite", "A cocktail"], answer: 0 },
    { q: "About how many sperm are in an average... deposit?", options: ["200-300 million", "Twelve", "A baker's dozen", "One determined lad"], answer: 0 },
    { q: "The G-spot is named after?", options: ["Dr. Gräfenberg", "Google", "A guy named Greg", "Nobody, it's a myth"], answer: 0 },
    { q: "In the bedroom, 'vanilla' means?", options: ["Plain, conventional sex", "Ice-cream foreplay", "A safe word", "Absolutely nothing"], answer: 0 },
    { q: "Which STI is nicknamed 'the clap'?", options: ["Gonorrhea", "Chlamydia", "Herpes", "A round of applause"], answer: 0 },
    { q: "The position '69' involves?", options: ["Mutual oral", "Math homework", "Two people napping", "A jersey number"], answer: 0 },
    { q: "What does 'BDSM' partly stand for?", options: ["Bondage & Discipline", "Big Dumb Silly Men", "Bring Drinks, Stay Mellow", "Breakfast During Sexy Mornings"], answer: 0 },
    { q: "An aphrodisiac is something that?", options: ["Boosts the mood", "Kills the mood", "Cleans the kitchen", "Pays your rent"], answer: 0 },
  ],
  party: [
    { q: "A Long Island Iced Tea contains how much actual tea?", options: ["None", "A splash", "Half", "It's all tea"], answer: 0 },
    { q: "What does 'BAC' stand for?", options: ["Blood Alcohol Concentration", "Beer And Chasers", "Big Ass Cup", "Booze Allowed, Captain"], answer: 0 },
    { q: "Which hangover 'cure' actually has some science behind it?", options: ["Water and sleep", "Hair of the dog", "Greasy fry-up", "Prayer"], answer: 0 },
    { q: "Tequila is made from which plant?", options: ["Agave", "Cactus", "Hops", "Pure regret"], answer: 0 },
    { q: "'Pregaming' means?", options: ["Drinking before going out", "Stretching", "Warming up the Xbox", "Sobering up"], answer: 0 },
    { q: "Which usually gives the nastiest hangover?", options: ["Dark liquors", "Vodka", "Water", "White wine"], answer: 0 },
    { q: "To 'shotgun' a beer, you?", options: ["Puncture and chug it", "Sip it politely", "Age it 10 years", "Pour it out"], answer: 0 },
    { q: "Absinthe was banned for supposedly causing?", options: ["Hallucinations", "Sobriety", "Good decisions", "Tax refunds"], answer: 0 },
    { q: "'The spins' hit when you're drunk and?", options: ["Lying down", "Doing yoga", "Stone-cold sober", "Winning"], answer: 0 },
    { q: "What's the strongest commonly-sold spirit, roughly?", options: ["Everclear (~95%)", "Light beer", "Baileys", "Kombucha"], answer: 0 },
  ],
  gross: [
    { q: "What's the technical name for earwax?", options: ["Cerumen", "Ear jam", "Brain butter", "Wax-on"], answer: 0 },
    { q: "Which animal can puke up its entire stomach and reset it?", options: ["Frogs", "Eagles", "Horses", "Hamsters"], answer: 0 },
    { q: "A fart is mostly made of?", options: ["Swallowed air and gas", "Pure evil", "Solid matter", "Helium"], answer: 0 },
    { q: "What chemical makes farts stink?", options: ["Sulfur compounds", "Methane", "Oxygen", "Your soul"], answer: 0 },
    { q: "British slang 'bog roll' means?", options: ["Toilet paper", "A pastry", "A swamp", "Sushi"], answer: 0 },
    { q: "Belly-button lint is mostly?", options: ["Clothing fibers and dead skin", "Bacteria gold", "Sand", "Nothing at all"], answer: 0 },
    { q: "Pus is mostly made of?", options: ["Dead white blood cells", "Milk", "Yoghurt", "Tears"], answer: 0 },
    { q: "Smegma is?", options: ["Genital build-up of oils & dead skin", "A Greek letter", "A type of cheese", "A Pokémon"], answer: 0 },
    { q: "Roughly how long is the adult human intestine?", options: ["About 7-9 metres", "30 cm", "1 metre", "A full mile"], answer: 0 },
    { q: "A 'Cleveland Steamer' is, unfortunately, a?", options: ["Vulgar sex act", "Steam train", "Carpet cleaner", "Cocktail"], answer: 0 },
  ],
  gk: [
    { q: "What's the capital of Australia?", options: ["Canberra", "Sydney", "Your mum's place", "Melbourne"], answer: 0 },
    { q: "How many bones are in the adult human body?", options: ["206", "300", "Twelve", "Depends on the night"], answer: 0 },
    { q: "Which planet spins on its side and is the butt of every joke?", options: ["Uranus", "Mars", "Venus", "Pluto"], answer: 0 },
    { q: "Most abundant gas in Earth's atmosphere?", options: ["Nitrogen", "Oxygen", "Fart gas", "Carbon dioxide"], answer: 0 },
    { q: "How many hearts does an octopus have?", options: ["Three", "One", "Eight", "Zero, like my ex"], answer: 0 },
    { q: "Which country basically invented getting naked with mates (saunas)?", options: ["Finland", "Brazil", "Canada", "Egypt"], answer: 0 },
    { q: "The currency of Japan is the?", options: ["Yen", "Won", "Yuan", "Booty"], answer: 0 },
    { q: "Mount Everest sits in which range?", options: ["The Himalayas", "The Alps", "The Andes", "Texas"], answer: 0 },
    { q: "Which language has the most native speakers?", options: ["Mandarin Chinese", "English", "Profanity", "Spanish"], answer: 0 },
    { q: "What's the largest organ in the human body?", options: ["The skin", "The liver", "The ego", "The heart"], answer: 0 },
  ],
  screen: [
    { q: "Which film gave us 'I'm the king of the world!'?", options: ["Titanic", "Frozen", "Shrek", "The Lion King"], answer: 0 },
    { q: "In Game of Thrones, a Lannister always pays his?", options: ["Debts", "Taxes", "Respects", "OnlyFans"], answer: 0 },
    { q: "Which show features Walter White cooking up trouble?", options: ["Breaking Bad", "MasterChef", "Bluey", "The Office"], answer: 0 },
    { q: "South Park is set in which US state?", options: ["Colorado", "Texas", "Florida", "Hell"], answer: 0 },
    { q: "Cardi B & Megan's filthy chart-topper 'WAP' stands for?", options: ["Wet... you know", "Water And Pipes", "Weekly Action Plan", "Wireless Access Point"], answer: 0 },
    { q: "The classic 'Rickroll' song is?", options: ["Never Gonna Give You Up", "Africa", "Sandstorm", "Despacito"], answer: 0 },
    { q: "Which boy band gave us 'Dirty Pop'?", options: ["NSYNC", "Backstreet Boys", "One Direction", "The Wiggles"], answer: 0 },
    { q: "Snoop Dogg briefly rebranded himself as?", options: ["Snoop Lion", "Snoop Cat", "DJ Snoopy", "Mr. Dogg"], answer: 0 },
    { q: "'Eat, sleep, rave, repeat' is a tune by?", options: ["Fatboy Slim", "Mozart", "ABBA", "Your dad"], answer: 0 },
    { q: "Which sitcom character yells 'BAZINGA'?", options: ["Sheldon Cooper", "Homer Simpson", "Michael Scott", "Joey"], answer: 0 },
  ],
};

// Merge in the extra banks (trades + topic expansions) from banks-extra.js.
BANKS.plumbing = extra.plumbing;
BANKS.electrical = extra.electrical;
BANKS.hvac = extra.hvac;
BANKS.alcohol = BANKS.alcohol.concat(extra.alcoholExtra);
BANKS.medical = BANKS.medical.concat(extra.medicalExtra);
BANKS.usacanada = BANKS.usacanada.concat(extra.usacanadaExtra);

// Drop duplicate questions (same question text) when building a pool.
function dedupeQuestions(list) {
  const seen = new Set();
  const out = [];
  for (const q of list) {
    const key = q.q.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

// Categories that only belong in filthy mode.
const ADULT_CATS = new Set(['filth', 'party', 'gross', 'gk', 'screen']);

function buildPool(categoryId, clean) {
  const wholeMix = categoryId === 'everything' || !BANKS[categoryId] || (clean && ADULT_CATS.has(categoryId));
  const banks = wholeMix
    ? Object.entries(BANKS).filter(([k]) => !(clean && ADULT_CATS.has(k))).map(([, v]) => v)
    : [BANKS[categoryId]];
  return dedupeQuestions(banks.flat());
}

// Exposed for Crazy Mode, which mixes trivia questions with other games.
export function everythingPool(clean) {
  return buildPool('everything', clean);
}

function categoryName(id) {
  const c = CATEGORIES.find((x) => x.id === id);
  return c ? c.name : 'A Bit of Everything';
}

function leaderboard(room) {
  return [...room.players.values()]
    .map((p) => ({ id: p.id, name: p.name, emoji: p.emoji || '', score: p.score, connected: p.connected }))
    .sort((a, b) => b.score - a.score);
}

function startQuestion(room, ctx) {
  const g = room.game;
  g.sub = 'question';
  g.answers = new Map();
  g.startedAt = Date.now();
  g.deadline = g.startedAt + QUESTION_MS;
  ctx.clearTimers();
  ctx.after(QUESTION_MS, () => reveal(room, ctx));
  ctx.broadcast();
}

function reveal(room, ctx) {
  const g = room.game;
  if (g.sub === 'reveal') return;
  g.sub = 'reveal';
  ctx.clearTimers();
  const question = g.questions[g.index];
  for (const [pid, ans] of g.answers) {
    const player = room.players.get(pid);
    if (!player) continue;
    if (ans.choice === question.answer) {
      const remaining = clamp(g.deadline - ans.at, 0, QUESTION_MS);
      ans.gained = 500 + Math.round(500 * (remaining / QUESTION_MS));
      player.score += ans.gained;
    } else {
      ans.gained = 0;
    }
  }
  ctx.after(REVEAL_MS, () => next(room, ctx));
  ctx.broadcast();
}

function next(room, ctx) {
  const g = room.game;
  g.index += 1;
  if (g.index >= g.questions.length) {
    ctx.end();
    return;
  }
  startQuestion(room, ctx);
}

export default {
  id: 'trivia',
  name: 'Filthy Trivia',
  emoji: '😈',
  description: 'Crude quiz across booze, sex, gore, gaming & more. Answer fast, answer right — speed earns bonus points.',
  minPlayers: 1,
  maxPlayers: 16,
  categories: CATEGORIES,
  lengths: LENGTHS,

  init(room, ctx) {
    const catId = (room.config && room.config.category) || 'everything';
    const length = normalizeLength(room.config && room.config.length);
    const clean = !!(room.config && room.config.clean);
    let pool =
      catId === 'custom' ? (room.config.customQuestions || []).slice() : buildPool(catId, clean);
    if (catId === 'custom' && pool.length === 0) {
      pool = [{ q: 'No custom questions yet — add some in the lobby!', options: ['OK', 'Got it', 'Sure', 'Fine'], answer: 0 }];
    }
    const count = Math.min(length, pool.length);
    room.game = {
      category: catId,
      categoryName: categoryName(catId),
      questions: pickSome(pool, count).map(shuffleQuestion),
      index: 0,
      sub: 'question',
      answers: new Map(),
      startedAt: 0,
      deadline: 0,
    };
    startQuestion(room, ctx);
  },

  action(room, playerId, action, ctx) {
    const g = room.game;
    if (!g) return;
    if (action.type === 'answer') {
      if (g.sub !== 'question') return;
      if (g.answers.has(playerId)) return;
      const choice = Number(action.choice);
      if (!Number.isInteger(choice) || choice < 0 || choice > 3) return;
      g.answers.set(playerId, { choice, at: Date.now() });
      const connected = ctx.connectedPlayers();
      const allAnswered = connected.every((p) => g.answers.has(p.id));
      if (allAnswered) reveal(room, ctx);
      else ctx.broadcast();
    } else if (action.type === 'next') {
      if (room.hostId !== playerId) return;
      if (g.sub === 'question') reveal(room, ctx);
      else next(room, ctx);
    }
  },

  view(room, playerId) {
    const g = room.game;
    if (!g) return null;
    const question = g.questions[g.index];
    const myAnswer = g.answers.get(playerId);
    const base = {
      sub: g.sub,
      index: g.index,
      total: g.questions.length,
      category: g.categoryName,
      question: question.q,
      options: question.options,
      leaderboard: leaderboard(room),
      answeredCount: g.answers.size,
      playerCount: [...room.players.values()].filter((p) => p.connected).length,
    };
    if (g.sub === 'question') {
      base.timeLeft = Math.max(0, g.deadline - Date.now());
      base.timeTotal = QUESTION_MS;
      base.youAnswered = !!myAnswer;
      base.yourChoice = myAnswer ? myAnswer.choice : null;
    } else {
      base.correct = question.answer;
      base.yourChoice = myAnswer ? myAnswer.choice : null;
      base.yourGain = myAnswer ? myAnswer.gained || 0 : 0;
      base.youCorrect = !!myAnswer && myAnswer.choice === question.answer;
      const counts = [0, 0, 0, 0];
      for (const a of g.answers.values()) counts[a.choice] = (counts[a.choice] || 0) + 1;
      base.counts = counts;
    }
    return base;
  },
};
