// api/analyze.js - DADOS REAIS API-FOOTBALL (sem OpenAI)
const API_KEY = process.env.API_FOOTBALL_KEY;

async function getTeamId(name) {
  try {
    const res = await fetch(`https://v3.football.api-sports.io/teams?search=${encodeURIComponent(name)}&country=Brazil`, {
      headers: { 'x-apisports-key': API_KEY }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.response?.[0]?.team?.id || null;
  } catch { return null; }
}

async function getForm(teamId) {
  try {
    const res = await fetch(`https://v3.football.api-sports.io/fixtures?team=${teamId}&last=5`, {
      headers: { 'x-apisports-key': API_KEY }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const fixtures = data.response || [];
    let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
    fixtures.forEach(f => {
      const isHome = f.teams.home.id === teamId;
      const gf = isHome ? f.goals.home : f.goals.away;
      const ga = isHome ? f.goals.away : f.goals.home;
      goalsFor += gf || 0;
      goalsAgainst += ga || 0;
      if (gf > ga) wins++; else if (gf === ga) draws++; else losses++;
    });
    return { wins, draws, losses, goalsFor, goalsAgainst, games: fixtures.length };
  } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const { games } = req.body || {};
    if (!games || !Array.isArray(games)) {
      return res.status(400).json({ error: 'Envie array de jogos' });
    }
    if (!API_KEY) {
      return res.status(500).json({ error: 'API_FOOTBALL_KEY não configurada no Vercel' });
    }

    const analises = [];

    for (const jogo of games) {
      const parts = jogo.split(/ x | vs | VS | - /i);
      const casaNome = parts[0]?.trim();
      const foraNome = parts[1]?.trim();
      
      let casaProb = 45, empateProb = 27, foraProb = 28;
      let justificativa = 'Baseado em mando de campo';

      const [idCasa, idFora] = await Promise.all([
        getTeamId(casaNome),
        getTeamId(foraNome)
      ]);

      if (idCasa && idFora) {
        const [formCasa, formFora] = await Promise.all([
          getForm(idCasa),
          getForm(idFora)
        ]);

        if (formCasa && formFora && formCasa.games > 0 && formFora.games > 0) {
          const aproveitamentoCasa = (formCasa.wins * 3 + formCasa.draws) / (formCasa.games * 3);
          const aproveitamentoFora = (formFora.wins * 3 + formFora.draws) / (formFora.games * 3);
          
          // Calcula com vantagem casa +15%
          const forcaCasa = aproveitamentoCasa * 0.7 + 0.15;
          const forcaFora = aproveitamentoFora * 0.7;
          const total = forcaCasa + forcaFora + 0.25; // empate base
          
          casaProb = Math.round((forcaCasa / total) * 100);
          foraProb = Math.round((forcaFora / total) * 100);
          empateProb = 100 - casaProb - foraProb;

          justificativa = `${casaNome}: ${formCasa.wins}V-${formCasa.draws}E-${formCasa.losses}D nos últimos 5 | ${foraNome}: ${formFora.wins}V-${formFora.draws}E-${formFora.losses}D. Dados reais API-Football.`;
        }
      }

      let sugestao = '1';
      if (foraProb > casaProb && foraProb > empateProb) sugestao = '2';
      else if (empateProb > casaProb && empateProb > foraProb) sugestao = 'X';
      
      const duplo = Math.abs(casaProb - foraProb) < 14;

      analises.push({
        jogo: `${casaNome} x ${foraNome}`,
        casa: casaProb,
        empate: empateProb,
        fora: foraProb,
        sugestao,
        duplo,
        justificativa
      });

      // Respeita limite API (pequeno delay)
      await new Promise(r => setTimeout(r, 200));
    }

    const seguros = [...analises].sort((a,b) => Math.max(b.casa,b.fora) - Math.max(a.casa,a.fora)).slice(0,3).map(a => a.jogo);
    const duplos = analises.filter(a => a.duplo).slice(0,3).map(a => a.jogo);
    const zebra = analises.find(a => a.sugestao === '2' && a.fora >= 35)?.jogo || analises[analises.length-1].jogo;

    return res.status(200).json({
      analises,
      resumo: { seguros, duplos, zebra },
      fonte: 'API-FOOTBALL - dados reais'
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
