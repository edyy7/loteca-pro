// api/analisar.js - Vercel Serverless Function
// Loteca PRO Automatizada com IA

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'MÃ©todo nÃ£o permitido' });
  }

  try {
    const { jogos } = req.body;
    
    if (!jogos || !Array.isArray(jogos) || jogos.length !== 14) {
      return res.status(400).json({ error: 'Envie exatamente 14 jogos' });
    }

    const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (!API_FOOTBALL_KEY || !OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Chaves de API nÃ£o configuradas no Vercel' });
    }

    // 1. BUSCAR FIXTURES DO DIA
    const hoje = new Date().toISOString().split('T')[0];
    const fixturesRes = await fetch(
      `https://v3.football.api-sports.io/fixtures?date=${hoje}&timezone=America/Sao_Paulo`,
      { headers: { 'x-apisports-key': API_FOOTBALL_KEY } }
    );
    const fixturesData = await fixturesRes.json();
    const fixtures = fixturesData.response || [];

    // 2. PARA CADA JOGO, ENCONTRAR FIXTURE E BUSCAR ODDS
    const jogosComDados = [];
    
    for (const jogoTexto of jogos) {
      const [timeA, timeB] = jogoTexto.split(/ x | X | vs |VS/).map(t => t.trim());
      
      // Busca fuzzy no fixture
      const fixture = fixtures.find(f => {
        const home = f.teams.home.name.toLowerCase();
        const away = f.teams.away.name.toLowerCase();
        return (home.includes(timeA.toLowerCase()) || timeA.toLowerCase().includes(home)) &&
               (away.includes(timeB.toLowerCase()) || timeB.toLowerCase().includes(away));
      });

      let odds = null;
      let fonte = 'API-Football';
      
      if (fixture) {
        const oddsRes = await fetch(
          `https://v3.football.api-sports.io/odds?fixture=${fixture.fixture.id}&bookmaker=8`,
          { headers: { 'x-apisports-key': API_FOOTBALL_KEY } }
        );
        const oddsData = await oddsRes.json();
        
        const bet = oddsData.response?.[0]?.bookmakers?.[0]?.bets?.find(b => b.name === 'Match Winner');
        if (bet) {
          const odd1 = parseFloat(bet.values.find(v => v.value === 'Home')?.odd);
          const oddX = parseFloat(bet.values.find(v => v.value === 'Draw')?.odd);
          const odd2 = parseFloat(bet.values.find(v => v.value === 'Away')?.odd);
          odds = { odd1, oddX, odd2 };
        }
      }

      jogosComDados.push({
        jogo: jogoTexto,
        timeA,
        timeB,
        fixture_encontrado: !!fixture,
        odds,
        fonte
      });
    }

    // 3. MONTAR PROMPT PARA OPENAI
    const systemPrompt = `VocÃª Ã© uma IA pesquisadora, auditora e validadora de dados da Loteca. Aja como cientista, nÃ£o como criativa.

REGRAS RIGOROSAS:
1. PROIBIDO INVENTAR â€“ nunca estimar, deduzir ou completar lacunas. Se nÃ£o houver dado, marque como null.
2. VALIDAÃ‡ÃƒO CRUZADA â€“ use os dados fornecidos da API-Football como fonte primÃ¡ria confiÃ¡vel. Indique quando nÃ£o hÃ¡ confirmaÃ§Ã£o secundÃ¡ria.
3. HIERARQUIA DE CONFIABILIDADE â€“ fontes oficiais prevalecem.
4. COMPARAÃ‡ÃƒO RIGOROSA â€“ confira nomes, datas, odds.
5. DETECÃ‡ÃƒO DE INCONSISTÃŠNCIAS â€“ mostre divergÃªncias.
6. PROIBIDO PULAR ETAPAS â€“ buscar â†’ coletar â†’ validar â†’ comparar â†’ confirmar â†’ preencher â†’ revisar â†’ auditar.
7. AUDITORIA FINAL OBRIGATÃ“RIA â€“ revise campos vazios e erros.
8. TRANSPARÃŠNCIA â€“ informe fontes e nÃ­vel de confianÃ§a (ALTO, MÃ‰DIO, BAIXO).
9. BLOQUEIO DE ALUCINAÃ‡ÃƒO â€“ se nÃ£o houver confirmaÃ§Ã£o suficiente, recuse o preenchimento parcial e explique.
10. PRECISÃƒO ABSOLUTA SOBRE VELOCIDADE.

CLASSIFICAÃ‡ÃƒO DE TIPOS:
- Tipo A (Morno): â‰¥8 jogos com odd do favorito â‰¤1.60 â†’ distribuiÃ§Ã£o: 8 secos, 4 duplos, 2 triplos
- Tipo B (EquilÃ­brio TÃ¡tico): 5-7 jogos com odds entre 1.80 e 2.20 â†’ 5 secos, 7 duplos, 2 triplos
- Tipo C (Caos Continental): â‰¥6 jogos com incerteza alta (odds 2.30-3.00 sem favorito claro) â†’ 6 secos, 6 duplos, 2 triplos
- Tipo D (Tempestade): â‰¥10 jogos sem favorito claro (odds >2.50) â†’ 2 secos, 8 duplos, 4 triplos

Subtipo: deduza pela IA (ex: MOTIVAÃ‡ÃƒO, ZEBRA, CLÃSSICO).
Tipo atÃ´mico: FORMATO TIPO-SUBTIPO-DISTRIBUIÃ‡ÃƒO (ex: C-MOT-6S6D2T).

TAREFA: Analise os 14 jogos com odds reais fornecidos. Calcule probabilidade implÃ­cita (1/odd), identifique incerteza, classifique o concurso, e gere palpites seguindo a distribuiÃ§Ã£o do tipo. Priorize jogos mais incertos para duplos/triplos.

RETORNE APENAS JSON VÃLIDO no formato:
{
  "tipo": "A|B|C|D",
  "subtipo": "string",
  "tipo_atomico": "string",
  "confianca": "ALTO|MEDIO|BAIXO",
  "distribuicao": {"secos": n, "duplos": n, "triplos": n},
  "ficha": [
    {"jogo": "", "odd1": n, "oddX": n, "odd2": n, "favorito": "1|X|2", "probabilidade": n, "tendencia": "", "incerteza": "BAIXA|MEDIA|ALTA", "motivo": ""}
  ],
  "palpites": ["1", "1X", "12", ... 14 itens],
  "fontes": ["API-Football"],
  "auditoria": {"jogos_validados": n, "jogos_sem_odds": n, "observacoes": ""}
}`;

    const userPrompt = `Jogos para anÃ¡lise:
${JSON.stringify(jogosComDados, null, 2)}`;

    // 4. CHAMAR OPENAI
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    const openaiData = await openaiRes.json();
    const resultado = JSON.parse(openaiData.choices[0].message.content);

    // 5. RETORNAR
    return res.status(200).json({
      sucesso: true,
      data_processamento: new Date().toISOString(),
      ...resultado,
      dados_brutos: jogosComDados
    });

  } catch (error) {
    console.error('Erro:', error);
    return res.status(500).json({ 
      error: 'Erro ao processar anÃ¡lise',
      detalhes: error.message 
    });
  }
}
