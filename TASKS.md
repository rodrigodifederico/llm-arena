# LLM Arena — Lista de Tarefas

> Atualizar durante o desenvolvimento: `[ ]` pendente · `[~]` em andamento · `[x]` concluído

## Fase 0 — Fundação do projeto
- [x] Scaffold Vite + React 18 + TypeScript
- [x] Tailwind CSS configurado (tema dark arena, acentos ciano/magenta por lado)
- [x] Zustand instalado; estrutura de pastas conforme §12 do spec
- [x] Setup de testes (Vitest) para os engines

## Fase 1 — Núcleo game-agnóstico
- [x] `engine/GameEngine.ts` — interface do contrato (§3) + PRNG seeded (mulberry32) + helpers
- [x] `llm/LLMClient.ts` — request OpenAI-compatible, timing, extração tolerante de JSON (fences/prosa), leitura de `usage` com fallback estimado (chars/4), erros distintos (CORS/HTTP/rede) *(adapter OpenAI embutido no client; interface permite adapters futuros)*
- [x] `match/MatchController.ts` — loop game-agnóstico (§4.2): retries (2), timeout por decisão (30s), `defaultAction` em falha, forfeit após 3 decisões consecutivas perdidas, suporte a jogos sequenciais e simultâneos (chamadas paralelas)
- [x] `match/replay.ts` — serialização do replay (§9), snapshots completos por turno, **sem API keys**
- [x] Stores: `configStore` (keys fora do export persistido), `matchStore`, `replayStore` (localStorage + IndexedDB via `idb`)

## Fase 2 — Os 4 jogos (cada um: engine puro + testes de determinismo/validação)
- [x] **Arena Clash** (§5): 10 arquétipos, draw 3v3 por seed, ordem por SPD, fórmulas físico/mágico, mana, statuses (buffs/DoTs/counter/taunt), cap 20 rounds → HP% total
- [x] **Hex Dominion** (§6): grid 7×7, HQs (30 HP), 4 minas simétricas com jitter seeded, economia de energia (income, carry-over cap 6), comandos move/attack/spawn com validação de orçamento/alcance/ocupação, cap 30 turnos
- [x] **Salvo** (§7): fase de posicionamento oculto (frota [5,4,3,3,2], validação de linhas/bounds/overlap), fase de tiros alternados, hit/miss/sunk, score = tiros do vencedor, informação assimétrica (cada modelo só vê o próprio board)
- [x] **Standoff** (§8): simultâneo, 3 vidas / 0 ammo, tabela de resolução reload/shield/shoot/mega, cap 40 rounds + morte súbita 5 rounds
- [x] 29 testes unitários passando (determinismo, validação, tabelas de resolução)

## Fase 3 — UI
- [x] `SetupScreen`: 2 cards simétricos (label, base URL, key mascarada + "lembrar", model + "Fetch models", toggle proxy, custos in/out, Test connection), settings globais (jogo, seed + 🎲, temperatura, allow thinking, retries, timeout), botão "Same model both sides", Start desabilitado até config válida
- [x] `ArenaScreen` + HUD compartilhado: headers com tokens in/out · latência média · custo acumulado · spinner "thinking", turn log expansível no rail direito (badge vermelho em forfeit), controles pause/step/abort (abort salva replay parcial)
- [x] Board **Arena Clash**: cards de personagem com HP/mana/status, glow no ativo, strip de última ação
- [x] Board **Hex Dominion**: grid colorido, tokens com HP pips, minas, barras de HQ, energia por lado
- [x] Board **Salvo**: dois grids 8×8 (visão de espectador com aviso de que os modelos não veem o grid inimigo)
- [x] Board **Standoff**: duelistas com corações/ammo, reveal animado por round
- [x] `ReplayScreen`: scrubber/timeline, ◀ ▮▮ ▶ + velocidade, inspetor por turno (prompt, raw, reasoning, ação, tokens, latência), sem chamadas de API

## Fase 4 — Robustez e entrega
- [x] Proxy local opcional (`proxy/local-proxy.js`) + toggle por lado + detecção de erro CORS com mensagem acionável na UI — testado com request real via proxy (HTTP 200)
- [x] Backoff em 429 (retry extra fora do orçamento de retries de jogada) + retry sem `response_format` em HTTP 400
- [x] Export/import de replay `.json` (validação na importação; strip defensivo de qualquer apiKey)
- [x] Tokens estimados marcados como "~ estimated" na UI quando provider omite `usage`
- [x] README: como rodar, proxy, mock server, export/import de replays
- [x] Servidor **mock** OpenAI-compatible (`npm run mock`) que joga movimentos legais nos 4 jogos — para testar sem gastar tokens
- [x] Passada final no checklist de aceitação (§14) — verificado e2e no browser: 4 partidas completas (Standoff draw 6t, Arena Clash vitória A 57t, Salvo vitória A em 64 tiros 129t, Hex draw por cap 30t), replays salvos sem API keys, replay player com inspetor OK, zero erros de console

## Verificação e2e realizada (2026-07-06)
- `npm test`: 34/34 testes passando · `npm run build`: limpo
- Partida real nos 4 jogos via mock LLM no browser (HUD, retries, replay, persistência IndexedDB)
- Proxy CORS validado com request POST real encaminhando Authorization

## Correção — suporte a modelos de raciocínio (2026-07-06)
Diagnóstico a partir de replay real (deepseek-v4-pro perdendo por erro): o cliente rejeitava respostas com `message.content` vazio, sinal típico de reasoning model (texto em `reasoning_content` ou truncado por `max_tokens`).
- [x] `LLMClient.ts`: fallback `content → reasoning_content → reasoning`
- [x] `LLMClient.ts`: `usage` lido ANTES de rejeitar (conteúdo vazio virou erro-suave com tokens/custo contabilizados, não exceção que zerava o log)
- [x] `LLMClient.ts`: `max_tokens` padrão 1024 → 4096; dica de truncamento quando `finish_reason === "length"`
- [x] Campo "Max output tokens" por competidor no Setup (default 4096) + `PlayerSetup.maxTokens`
- [x] Testes `LLMClient.test.ts` (5) reproduzindo o bug + verificação e2e: reasoner mock passou de 12/16 inválidas + 2 forfeits para 23/23 válidas, 0 forfeits, e venceu
- [x] `mock/reasoning-mock.js`: mock de reasoning model (content vazio + reasoning_content) para regressão

## Sprites de ação + animações do Arena Clash (2026-07-07)
- [x] Engine emite evento estruturado `lastEvent` (ator, kind, ability, motion melee/ranged/cast/support, alvos, efeitos com dano/cura/veneno/morte/status/mana) — capturado nos snapshots, então replays animam igual
- [x] `ui/sprites/useSpritePoses.ts`: gera em runtime, a partir dos PNGs existentes, 9 frames de pose por personagem (idle, windup, strike, shoot, cast, hit, heal, guard, fall) via canvas — chromakey + transform + tint/glow, com cache por sprite
- [x] 8 sprites SVG de efeito em `public/sprites/fx/`: slash, impact, heal, cast-circle, shield, poison, skull, arrow
- [x] Board: máquina de animação em 2 fases dirigida pelo evento (windup → impacto), substituindo o parsing por regex do texto de log
- [x] Números de combate flutuantes (-dano vermelho, +cura verde, veneno, status, +MP) e morte com pose de queda + caveira antes do ghost
- [x] Sons casados com o evento (death > damage > heal > poison > shield)
- [x] Mock do Arena Clash agora usa heal/special (exercita todas as animações); correções de typecheck em código externo (NodeJS.Timeout, lives por round no Standoff, prop `active` no card do Team A)
- [x] Verificado no browser: poses, slash/impacto, cast circle, +30 de cura, recoil, skull; 35/35 testes, build limpo, zero erros de console
- [x] Setas de ação removidas (desenhadas no plano do chão isométrico, nunca alinhavam com os billboards dos personagens — feedback do operador); ação segue comunicada por lunge + FX no alvo + números flutuantes + speech bubble

## Stretch (não bloqueia v1)
- [ ] Torneio round-robin com leaderboard
- [ ] Best-of-N por confronto
- [ ] Streaming de tokens
- [ ] Adapter Anthropic Messages API
- [ ] Modo humano-vs-LLM
- [ ] Export CSV de métricas por turno
