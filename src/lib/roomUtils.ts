/**
 * Generiert kurze Abkürzungen für Raumnamen
 * z.B. "Zimmer Luis" → "Luis", "Schlafzimmer Uli" → "SZ.U", "Wohnzimmer" → "Wohn"
 */
export const getRoomAbbr = (name: string | undefined): string => {
  if (!name) return '';
  const words = name.split(' ').filter(w => w.length > 0);
  const lowerName = name.toLowerCase();
  
  if (words.length >= 2) {
    const firstWord = words[0].toLowerCase();
    const secondWord = words[1];
    
    // "Zimmer Luis/Luca" → "Luis/Luca"
    if (firstWord === 'zimmer' && secondWord.length <= 5) {
      return secondWord;
    }
    
    // "Bad Uli" → "Uli" (zeige den Namen)
    if (firstWord === 'bad' && secondWord.length <= 4) {
      return secondWord;
    }
    
    // "Kinder Bad" → "K.Bad"
    if (lowerName === 'kinder bad') {
      return 'K.Bad';
    }
    
    // "Schlafzimmer Uli" → "SZ.U"
    if (firstWord === 'schlafzimmer') {
      return 'SZ.' + secondWord[0].toUpperCase();
    }
    
    // Standard: Erste Buchstaben
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  
  // Kurze einwörtrige Namen vollständig anzeigen (Büro, Flur, etc.)
  if (name.length <= 5) {
    return name;
  }
  
  // Längere einwörtrige Namen: "Wohnzimmer" → "Wohn"
  return name.substring(0, 4);
};
