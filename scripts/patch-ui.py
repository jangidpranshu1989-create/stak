#!/usr/bin/env python3
"""Patch the prebuilt Stak UI bundle (original UI kept 1:1) for v4:
- removes every user-visible "AI" wording (all 10 languages)
- the model picker is hidden by public/stak-patch.css (routing is automatic)
Writes public/assets/index-v4.js and points index.html at it. Idempotent: always starts from the original bundle."""
import pathlib, re, sys
root = pathlib.Path(__file__).resolve().parent.parent
pub = root / "public"
src = (pub / "assets" / "index-dfQllqH2.js").read_text(encoding="utf-8")
R = [
  ('"AI chatbot app"', '"Chatbot app"'),
  ('"AI se edit"', '"Stak se edit"'), ('"AI se fix karo"', '"Stak se fix karo"'),
  ('"AI se koi bhi part badlo, phir export karo."', '"Stak se koi bhi part badlo, phir export karo."'),
  ('"Abhi koi key nahi. Stak AI, database aur login bina key ke chalte hain."', '"Abhi koi key nahi. Stak database aur login bina key ke chalte hain."'),
  ('"Edit any part with AI, then export."', '"Edit any part with Stak, then export."'),
  ('"Edit with AI"', '"Edit with Stak"'), ('"Fix with AI"', '"Fix with Stak"'),
  ('"Full stack · AI"', '"Full stack · Live"'),
  ('"Interface, voice aur AI replies — sab aapki language me."', '"Interface, voice aur replies — sab aapki language me."'),
  ('"Interface, voice input and AI replies — all in the language you think in."', '"Interface, voice input and replies — all in the language you think in."'),
  ('"Live preview · AI se edit · ZIP download"', '"Live preview · Stak se edit · ZIP download"'),
  ('"Live preview · Edit with AI · ZIP export"', '"Live preview · Edit with Stak · ZIP export"'),
  ('"Login, database, AI and API keys for this app — live and working."', '"Login, database and API keys for this app — live and working."'),
  ('"No keys yet. Built-in Stak AI, database and login work without any key."', '"No keys yet. Built-in Stak database and login work without any key."'),
  ('"Aperçu en direct · Édition IA · ZIP"', '"Aperçu en direct · Édition Stak · ZIP"'),
  ('"Edita cualquier parte con IA."', '"Edita cualquier parte con Stak."'),
  ('"Editar con IA"', '"Editar con Stak"'),
  ('"Interface, voix et réponses IA dans votre langue."', '"Interface, voix et réponses dans votre langue."'),
  ('"Interfaz, voz y respuestas de IA en tu idioma."', '"Interfaz, voz y respuestas en tu idioma."'),
  ('"Modifiez n\'importe quoi avec l\'IA."', '"Modifiez n\'importe quoi avec Stak."'),
  ('"Vista en vivo · Editar con IA · ZIP"', '"Vista en vivo · Editar con Stak · ZIP"'),
  ('"Éditer avec l\'IA"', '"Éditer avec Stak"'),
  ('||"Stak Pro"', '||"Stak"'),
]
n = 0
for a, b in R:
  c = src.count(a)
  if not c: print("WARN not found:", a, file=sys.stderr)
  n += c; src = src.replace(a, b)
# Indic scripts: "AI" token inside short UI strings → "Stak"
def indic(m):
  s = m.group(0)
  return s.replace("AI ", "Stak ").replace(" AI", "") if re.search(r'[\u0900-\u0DFF]', s) else s
src2 = re.sub(r'"[^"\n]{0,80}\bAI\b[^"\n]{0,80}"', indic, src)
src2 = re.sub(r'(?<![\w.#-])5 (?=(?:smart|quick|chhote|स्मार्ट|छोटे|preguntas|questions|polls|sondages|encuestas|கேள்வி|ஸ்மார்ட்|పోల్|స్మార్ట్|প্রশ্ন|স্মার্ট|प्रश्न|સવાલ|પ્રશ્ન|સ્માર્ટ|পোল|पोल))', '3 ', src2)
src2 = src2.replace("Answer 5 quick", "Answer 3 quick").replace("Bas 5 chhote", "Bas 3 chhote")
left = sorted(set(re.findall(r'"[^"\n]{0,60}\bAI\b[^"\n]{0,60}"', src2)))
(pub / "assets" / "index-v4.js").write_text(src2, encoding="utf-8")
html = (pub / "index.html").read_text(encoding="utf-8")
html = re.sub(r'assets/index-[\w-]+\.js', 'assets/index-v4.js', html)
(pub / "index.html").write_text(html, encoding="utf-8")
print(f"replaced {n} strings; remaining 'AI' strings: {left}")
