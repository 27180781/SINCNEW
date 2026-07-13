import { api, setElements, ELEMENT_ORDER, elLabel, elColor, elEmoji, el } from './api.js';

async function boot() {
  const cfg = await api.get('/api/config'); // ציבורי — ללא צורך בטוקן
  setElements(cfg.elements);
  if (cfg.title) document.getElementById('title').textContent = cfg.title;
  if (cfg.subtitle) document.getElementById('subtitle').textContent = cfg.subtitle;

  const box = document.getElementById('elementCards');
  box.innerHTML = '';
  const traits = { fire: 'תשוקה ואנרגיה', water: 'רגש ואינטואיציה', air: 'מחשבה ותקשורת', earth: 'יציבות ומעשיות' };
  for (const k of ELEMENT_ORDER) {
    box.appendChild(el('div', { class: 'card stat', style: `border-top:4px solid ${elColor(k)}` }, [
      el('div', { style: 'font-size:2rem' }, elEmoji(k)),
      el('div', { class: 'num', style: `color:${elColor(k)};font-size:1.2rem` }, elLabel(k)),
      el('div', { class: 'lbl' }, traits[k] || ''),
    ]));
  }
}

boot().catch(() => { /* דף מידע — נכשל בשקט אם ה-API לא זמין */ });
