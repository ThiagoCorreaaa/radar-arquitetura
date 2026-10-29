# Radar da Arquitetura

Site estático que mostra as principais notícias de arquitetura no Brasil. Um robô (GitHub Actions) roda **todo dia às 5h30 (horário de Campo Grande/MS)**, lê os feeds públicos do Google Notícias e regrava o arquivo `news.json`. O Netlify republica o site automaticamente. **Sem custo e sem depender de nenhuma outra ferramenta.**

## Arquivos

- `index.html` — a página (lê o `news.json` ao abrir).
- `news.json` — as notícias atuais (gerado pelo robô; já vem com uma versão inicial).
- `scripts/build-news.mjs` — o robô que busca as notícias e gera o `news.json`.
- `.github/workflows/update-news.yml` — o agendamento diário no GitHub.

## Passo a passo (uma vez só)

### 1. Criar o repositório no GitHub
1. Crie uma conta gratuita em https://github.com (se ainda não tiver).
2. Clique em **New repository**, dê um nome (ex.: `radar-arquitetura`) e crie.
3. Em **uploading an existing file**, arraste **todos** estes arquivos e pastas — mantendo as pastas `scripts` e `.github/workflows`. Confirme com **Commit changes**.

### 2. Ligar o robô
1. No repositório, abra a aba **Actions**. Se pedir, clique em **I understand... enable workflows**.
2. Para testar na hora: clique em **Atualizar notícias** → **Run workflow**. Em ~1 minuto ele gera um `news.json` novo.
3. Daí em diante, ele roda sozinho todo dia às 5h30.

### 3. Publicar no Netlify
1. Crie uma conta gratuita em https://netlify.com (dá para entrar com o próprio GitHub).
2. Clique em **Add new site** → **Import an existing project** → **GitHub** e escolha o repositório `radar-arquitetura`.
3. Nas opções de build, deixe **Build command** vazio e **Publish directory** como a raiz (`.`). Clique em **Deploy**.
4. Pronto — o Netlify te dá um endereço (ex.: `seu-site.netlify.app`). Toda vez que o robô atualizar o `news.json`, o Netlify republica sozinho.

Depois, se quiser, dá para ligar um **domínio próprio** nas configurações do Netlify.

## Ajustes fáceis

- **Horário:** mude o `cron` em `.github/workflows/update-news.yml`. O valor está em UTC; Campo Grande é UTC−4 (5h30 local = `30 9`).
- **Temas e buscas:** edite a lista `FEEDS` no topo de `scripts/build-news.mjs` (cada linha é um tema + uma busca no Google Notícias).
- **Janela de tempo:** `WHEN = 'when:45d'` limita às notícias dos últimos ~45 dias.
- **Quantidade:** `PER_CAT` controla quantas notícias por tema aparecem.

## Observações

- As notícias vêm "cruas" dos feeds (título + fonte + link), sem resumo reescrito — é a opção gratuita e sem dependências.
- Agendamentos do GitHub Actions podem atrasar alguns minutos em horários de pico.
- O GitHub pausa agendamentos se o repositório ficar ~60 dias sem nenhuma atividade; qualquer commit reativa.
- Teste sempre pelo endereço do Netlify (abrir o `index.html` com duplo clique no computador não carrega o `news.json` por segurança do navegador).
