type DictationReplacement = readonly [source: string, replacement: string];

// Keep this as a local, deterministic pass over the transcript. It is deliberately
// applied only to speech input, never to text a user types into the composer.
const DICTATION_REPLACEMENTS: readonly DictationReplacement[] = [
  ["Bauer", "Bower"], ["Bowar", "Bower"], ["cats", "Katz"],
  ["Gerish", "Gerrish"], ["Garish", "Gerrish"], ["Garrish", "Gerrish"],
  ["Nusbaum", "Nussbaum"],
  ["Hagee", "Hagy"], ["hay ghee", "Hagy"], ["hey G", "Hagy"],
  ["distal paint", "distal pancreatectomy"], ["distal pain", "distal pancreatectomy"], ["distal pink", "distal pancreatectomy"], ["distal pains", "distal pancreatectomy"], ["distal paints", "distal pancreatectomy"],
  ["lap cole", "laparoscopic cholecystectomy"], ["lap cold", "laparoscopic cholecystectomy"], ["lap coal", "laparoscopic cholecystectomy"], ["lap call", "laparoscopic cholecystectomy"], ["lap coli", "laparoscopic cholecystectomy"], ["lap choli", "laparoscopic cholecystectomy"],
  ["lap coli cystectomy", "laparoscopic cholecystectomy"], ["lap coliectomy", "laparoscopic cholecystectomy"], ["laparoscopic coli cystectomy", "laparoscopic cholecystectomy"],
  ["lap happy", "lap appy"], ["lap epi", "lap appy"],
  ["x lap", "ex lap"], ["explore lap", "ex lap"], ["x-lap", "ex lap"],
  ["gram patch", "Graham patch"], ["ripple", "Whipple"], ["pancreatic duodenectomy", "pancreaticoduodenectomy"], ["sub total gastrectomy", "subtotal gastrectomy"], ["esophageal ectomy", "esophagectomy"], ["ivory lewis", "Ivor Lewis"], ["mccune", "McKeown"],
  ["sig colectomy", "sigmoid colectomy"], ["low interior", "low anterior resection"], ["iliostomy", "ileostomy"], ["colonostomy", "colostomy"], ["heartman's", "Hartmann's"], ["hardman's", "Hartmann's"],
  ["eye palm", "IPOM"], ["i palm", "IPOM"], ["license of adhesions", "lysis of adhesions"], ["lies of adhesions", "lysis of adhesions"], ["innerotomy", "enterotomy"], ["anastomoses", "anastomosis"],
  ["jay tube", "J-tube"], ["gee tube", "G-tube"], ["peg tube", "PEG tube"], ["common bio duct", "common bile duct"], ["eye o c", "IOC"], ["I oh see", "IOC"], ["ohio c", "IOC"],
  ["coker maneuver", "Kocher maneuver"], ["coke or maneuver", "Kocher maneuver"], ["cattle brash", "Cattell-Braasch"], ["trites", "ligament of Treitz"], ["traits", "ligament of Treitz"], ["momentum", "omentum"], ["celiac access", "celiac axis"], ["gda", "GDA"],
  ["ruen y", "Roux-en-Y"], ["roux and why", "Roux-en-Y"], ["nissan", "Nissen"], ["toupee", "Toupet"], ["door fundoplication", "Dor fundoplication"], ["heller miotomy", "Heller myotomy"], ["poem", "POEM"], ["arma", "ARMA"], ["cirrhosis", "serosa"],
  ["callot's triangle", "Calot's triangle"], ["critical review", "Critical View of Safety"], ["league assure", "LigaSure"], ["in seal", "EnSeal"], ["synchro seal", "SynchroSeal"], ["vessel sealer extend", "Vessel Sealer"], ["endo gia", "Endo GIA"], ["sure form", "SureForm"],
  ["hemolock", "Hem-o-lok"], ["hemlock", "Hem-o-lok"], ["weck", "Weck clip"], ["vista seal", "Vistaseal"], ["tissue seal", "Tisseel"], ["surgical", "Surgicel"], ["flow seal", "Floseal"], ["symbol text", "Symbotex"], ["pro grip", "ProGrip"], ["jay pee drain", "JP drain"],
  ["fashion", "fascia"], ["pre peritoneal", "preperitoneal"], ["retro rectus", "retrorectus"], ["varus", "Veress"], ["hassan", "Hasson"], ["davinci", "da Vinci"], ["x i", "Xi"],
  ["common bowel duck", "common bile duct"], ["bowel duck", "bile duct"], ["hepatic duck", "hepatic duct"], ["cystic duck", "cystic duct"], ["bowel leak", "bile leak"], ["bowel ducts", "bile ducts"],
  ["coal angio gram", "cholangiogram"], ["cole angio gram", "cholangiogram"], ["coal angio graphy", "cholangiography"], ["coal edocholithiasis", "choledocholithiasis"], ["cole edocholithiasis", "choledocholithiasis"], ["coal edochotomy", "choledochotomy"], ["coal edochoscopy", "choledochoscopy"],
  ["hepatic ojejunostomy", "hepaticojejunostomy"], ["coal edochojejunostomy", "choledochojejunostomy"], ["gastro jejunostomy", "gastrojejunostomy"], ["jejuno jejunostomy", "jejunojejunostomy"], ["leocecectomy", "ileocecectomy"], ["ilio colic", "ileocolic"], ["meso appendix", "mesoappendix"], ["meso colon", "mesocolon"],
  ["retro peritoneum", "retroperitoneum"], ["hepato duodenal ligament", "hepatoduodenal ligament"], ["gastro splenic ligament", "gastrosplenic ligament"], ["spleno colic ligament", "splenocolic ligament"], ["lymph adenectomy", "lymphadenectomy"], ["fund application", "fundoplication"], ["hiatal harnia", "hiatal hernia"], ["paraesophageal harnia", "paraesophageal hernia"], ["pneumo peritoneum", "pneumoperitoneum"], ["robot assisted", "robotic-assisted"]
];

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
const replacementBySource = new Map(DICTATION_REPLACEMENTS.map(([source, replacement]) => [source.toLowerCase(), replacement]));

// One compiled expression keeps the correction pass fast even as the dictionary grows.
// Sorting lets a longer alias take precedence whenever two aliases start at the same spot.
const dictationAliasPattern = new RegExp(
  `(^|[^\\p{L}\\p{N}])(${[...replacementBySource.keys()].sort((a, b) => b.length - a.length).map(escaped).join("|")})(?=$|[^\\p{L}\\p{N}])`,
  "giu"
);

export function applyDictationReplacements(transcript: string): string {
  return transcript.replace(dictationAliasPattern, (match, prefix: string, alias: string) =>
    `${prefix}${replacementBySource.get(alias.toLowerCase()) ?? match}`
  );
}
