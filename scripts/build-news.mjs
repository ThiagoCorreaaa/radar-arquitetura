// Robô do Radar da Arquitetura — lê o Google Notícias (RSS público) e gera news.json.
// Resumo de cada notícia via Google Gemini, a partir da descrição da própria matéria.
// Roda no GitHub Actions (Node 20+, fetch nativo). Sem dependências externas.
import { writeFileSync } from 'node:fs';

// Temas e buscas. Cada item encontrado herda a categoria da sua busca.
const FEEDS = [
  { cat: 'profissao',  q: 'CAU arquitetura urbanismo Brasil' },
  { cat: 'profissao',  q: 'FNA arquitetos Brasil moradia' },
  { cat: 'premios',    q: 'prêmio arquitetura brasileira' },
  { cat: 'premios',    q: 'arquiteto brasileiro prêmio internacional' },
  { cat: 'eventos',    q: 'congresso bienal arquitetura Brasil' },
  { cat: 'eventos',    q: 'CASACOR mostra arquitetura' },
  { cat: 'tendencias', q: 'tendências arquitetura Brasil' },
  { cat: 'tendencias', q: 'tendências design de interiores Brasil' },
];

const WHEN = 'when:45d';   // só notícias dos últimos ~45 dias
const PER_QUERY = 5;       // máximo por busca
const PER_CAT   = 5;       // máximo por tema no resultado final
const MIN_TOTAL = 4;       // abaixo disso, não sobrescreve (mantém o último bom)
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

// IA (Google Gemini). Sem GEMINI_API_KEY, o robô segue sem resumos.
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL_OVERRIDE = process.env.GEMINI_MODEL || '';
const UA = 'Mozilla/5.0 (compatible; RadarArquitetura/1.0; +https://news)';

function decode(s){
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'").replace(/&apos;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&#(\d+);/g, (_,n)=>String.fromCharCode(+n))
    .replace(/&amp;/g,'&');
}
function stripTags(s){ return String(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }
function pick(block, name){
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}
function normKey(t){
  return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim().slice(0,70);
}

// --- Descoberta do modelo e leitura da matéria ---------------------------------
async function pickModel(){
  if(GEMINI_MODEL_OVERRIDE) return GEMINI_MODEL_OVERRIDE;
  try{
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`);
    if(!r.ok) return 'gemini-2.5-flash';
    const d = await r.json();
    const models = (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'));
    const flash = models.find(m => /flash/i.test(m.name) && !/(thinking|exp|preview|lite|vision)/i.test(m.name))
               || models.find(m => /flash/i.test(m.name)) || models[0];
    return flash ? flash.name.replace(/^models\//,'') : 'gemini-2.5-flash';
  }catch(e){ return 'gemini-2.5-flash'; }
}

function metaDesc(html){
  const grab = re => { const m = html.match(re); return m ? decode(m[1]).trim() : ''; };
  return grab(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      || grab(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)
      || grab(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      || grab(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
      || '';
}
function realUrl(html){
  const m = html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)
         || html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  return m ? m[1] : '';
}
async function getHtml(url){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 9000);
  try{
    const res = await fetch(url, { redirect:'follow', signal: ctrl.signal, headers: { 'User-Agent': UA } });
    if(!res.ok) return '';
    return await res.text();
  }catch(e){ return ''; }
  finally{ clearTimeout(t); }
}
// Tenta obter um trecho/descrição real da matéria (lida com o redirecionamento do Google Notícias).
async function fetchContext(url){
  let html = await getHtml(url);
  if(!html) return '';
  let desc = metaDesc(html);
  if(desc && desc.length >= 40) return desc.slice(0, 400);
  const real = realUrl(html);
  if(real && /^https?:/.test(real) && !/news\.google\./.test(real)){
    const html2 = await getHtml(real);
    if(html2){ const d2 = metaDesc(html2); if(d2) return d2.slice(0, 400); }
  }
  return desc ? desc.slice(0, 400) : '';
}

async function addResumos(items){
  if(!GEMINI_KEY || !items.length){ console.log('Sem chave de IA — seguindo sem resumos.'); return; }
  const model = await pickModel();
  const contextos = await Promise.all(items.map(it => fetchContext(it.url)));
  console.log(`Contexto obtido de ${contextos.filter(Boolean).length}/${items.length} matérias.`);
  const lista = items.map((it,i)=>{
    const c = contextos[i] ? `\n   Descrição: ${contextos[i]}` : '';
    return `${i+1}. Título: "${it.titulo}" (fonte: ${it.fonte})${c}`;
  }).join('\n');
  const prompt = `Você recebe notícias de arquitetura no Brasil, cada uma com o título e, quando disponível, uma descrição da matéria. Para cada notícia, escreva um resumo de 1 a 2 frases em português, informativo e neutro, baseado na descrição (reescrevendo com suas próprias palavras, sem copiar literalmente) e no título. Quando houver descrição, traga a informação dela — não repita apenas o título. Não invente fatos, números, nomes ou datas que não estejam no material. Responda APENAS com um array JSON de strings, na mesma ordem das notícias, sem comentários e sem texto fora do array.\n\nNotícias:\n${lista}`;
  try{
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4 } }),
    });
    if(!res.ok){ console.error(`IA indisponível (modelo ${model}, status ${res.status}) — seguindo sem resumos.`); return; }
    const data = await res.json();
    let txt = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json/gi,'').replace(/```/g,'').trim();
    const start = txt.indexOf('['), end = txt.lastIndexOf(']');
    if(start >= 0 && end > start) txt = txt.slice(start, end+1);
    const arr = JSON.parse(txt);
    if(Array.isArray(arr)){
      items.forEach((it,i)=>{ if(typeof arr[i] === 'string' && arr[i].trim()) it.resumo = arr[i].trim(); });
      console.log(`Resumos gerados pela IA (modelo ${model}).`);
    }
  }catch(e){ console.error('Falha ao gerar resumos: ' + e.message + ' — seguindo sem resumos.'); }
}

// --- Coleta das notícias --------------------------------------------------------
function gnUrl(q){
  const query = encodeURIComponent(`${q} ${WHEN}`);
  return `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-150`;
}

export function parseItems(xml, limit = PER_QUERY){
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while((m = re.exec(xml)) && items.length < limit){
    const b = m[1];
    const rawTitle = decode(pick(b,'title')).trim();
    const link = decode(pick(b,'link')).trim();
    const pub = pick(b,'pubDate').trim();
    let fonte = stripTags(decode(pick(b,'source'))).trim();
    let titulo = rawTitle;
    const idx = rawTitle.lastIndexOf(' - ');
    if(idx > 20){ titulo = rawTitle.slice(0, idx).trim(); if(!fonte) fonte = rawTitle.slice(idx+3).trim(); }
    if(!fonte) fonte = 'Google Notícias';
    if(!titulo || !link) continue;
    const d = pub ? new Date(pub) : new Date();
    const dt = isNaN(d) ? new Date() : d;
    items.push({
      titulo, url: link, fonte,
      data: `${dt.getUTCDate()} ${MESES[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`,
      sk: dt.getUTCFullYear()*10000 + (dt.getUTCMonth()+1)*100 + dt.getUTCDate(),
    });
  }
  return items;
}

async function fetchFeed(url){
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if(!res.ok) throw new Error('status '+res.status);
  return parseItems(await res.text());
}

async function main(){
  const seen = new Set();
  const byCat = { profissao:[], premios:[], eventos:[], tendencias:[] };

  for(const f of FEEDS){
    let list = [];
    try { list = await fetchFeed(gnUrl(f.q)); }
    catch(e){ console.error(`Falha na busca "${f.q}": ${e.message}`); continue; }
    for(const it of list){
      const key = normKey(it.titulo);
      if(key.length < 10 || seen.has(key)) continue;
      seen.add(key);
      byCat[f.cat].push({ cat: f.cat, ...it });
    }
  }

  const items = [];
  for(const cat of Object.keys(byCat)){
    byCat[cat].sort((a,b)=>b.sk-a.sk);
    items.push(...byCat[cat].slice(0, PER_CAT));
  }
  items.sort((a,b)=>b.sk-a.sk);

  if(items.length < MIN_TOTAL){
    console.error(`Apenas ${items.length} itens — abaixo do mínimo (${MIN_TOTAL}). news.json não foi alterado.`);
    process.exit(1);
  }

  await addResumos(items);

  const updatedLabel = new Date().toLocaleDateString('pt-BR',
    { day:'2-digit', month:'long', year:'numeric', timeZone:'America/Campo_Grande' });

  writeFileSync('news.json', JSON.stringify({ updatedLabel, items }, null, 2));
  console.log(`news.json gerado com ${items.length} notícias.`);
}
import { argv } from 'node:process';
if(import.meta.url === `file://${argv[1]}`){
  main().catch(e=>{ console.error(e); process.exit(1); });
}
