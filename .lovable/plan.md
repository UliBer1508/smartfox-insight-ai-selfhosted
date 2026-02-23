

# Scroll-Problem beheben

## Ursache

In `src/pages/Index.tsx` Zeile 163 hat das `<main>`-Element die Klasse `overflow-hidden`, die **jegliches Scrollen** innerhalb dieses Elements unterdrueckt. Da der gesamte Seiteninhalt in diesem Element liegt, kann die Seite nicht mehr gescrollt werden.

Zusaetzlich setzt `src/index.css` (Zeile 115-117) `overflow-x: hidden` auf `html`, `body` und `#root` gleichzeitig -- das kann in manchen Browsern dazu fuehren, dass auch `overflow-y` implizit auf `auto` statt `visible` gesetzt wird und Scroll-Kontexte kollidieren.

## Loesung

### 1. Index.tsx - `overflow-hidden` entfernen
- Zeile 163: `overflow-hidden` aus der `<main>`-Klasse entfernen
- Stattdessen nichts oder `overflow-x-hidden` verwenden (nur horizontales Overflow verhindern)

### 2. index.css - overflow-Regeln vereinfachen
- `overflow-x: hidden` nur auf `body` setzen, nicht auf alle drei Elemente (`html`, `body`, `#root`)
- Das verhindert die Browser-Eigenheit, bei der `overflow-x: hidden` auf `html` den vertikalen Scroll stoert

## Technische Details

**Index.tsx Zeile 163** aendern von:
```
overflow-hidden box-border
```
zu:
```
overflow-x-hidden box-border
```

**index.css Zeile 115-117** aendern von:
```css
html, body, #root {
  overflow-x: hidden;
  max-width: 100vw;
}
```
zu:
```css
html, body {
  max-width: 100vw;
}
body {
  overflow-x: hidden;
}
```

